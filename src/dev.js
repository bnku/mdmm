import { watch } from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  createDependencyGraph,
  diffSharedDeclarations,
  discoverSourceDocs,
  getDocumentOutputPath,
  markDocumentDirty,
  removeDocument,
  replaceSharedDeclarations,
  setSourceDocs,
  upsertDocumentState,
  scanSharedDeclarations,
} from "./dependency-graph.js";
import { MermaidIncludeError } from "./errors.js";
import { removeFileIfExists, statInputPath, writeTextFile } from "./files.js";
import { buildDocumentArtifacts } from "./preprocess.js";
import { CONFIG_FILE_NAME, isSameOrNestedPath, loadProjectSettings } from "./project.js";
import { validateMarkdownMermaid } from "./validator.js";

const DEFAULT_DEBOUNCE_MS = 100;

export async function startDevSession(options = {}) {
  const session = new DevSession(options);
  await session.start();
  return session;
}

class DevSession {
  constructor(options) {
    this.cwd = path.resolve(options.cwd ?? process.cwd());
    this.logger = options.logger;
    this.inputArg = options.inputPath ?? null;
    this.outputArg = options.outputPath ?? null;
    this.maxIncludeDepth = options.maxIncludeDepth ?? 5;
    this.validate = options.validate ?? true;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.pendingPaths = new Set();
    this.pendingFlushTimer = null;
    this.pendingRetry = false;
    this.runPromise = null;
    this.closed = false;
    this.sharedRegistryDirty = false;
    this.watchRoot = this.cwd;
    this.watcher = null;
    this.graph = null;
    this.done = new Promise((resolve) => {
      this.resolveDone = resolve;
    });
  }

  async start() {
    this.graph = await createProjectGraph({
      cwd: this.cwd,
      inputArg: this.inputArg,
      outputArg: this.outputArg,
    });
    this.watchRoot = this.graph.projectSettings.baseDir;
    this.watcher = watch(
      this.watchRoot,
      {
        recursive: true,
      },
      (eventType, filename) => {
        void this.handleWatchEvent(eventType, filename);
      },
    );
    await this.processChanges([], {
      forceAllDocs: true,
      reloadGraph: false,
      reason: "initial build",
    });
    this.logger.info(
      `Watching ${path.relative(this.cwd, this.graph.inputPath) || "."} and ${path.relative(this.cwd, this.graph.projectSettings.sharedDir) || "."} for changes. Press Ctrl+C to stop.`,
    );
  }

  async close() {
    if (this.closed) {
      return;
    }

    this.closed = true;

    if (this.pendingFlushTimer) {
      clearTimeout(this.pendingFlushTimer);
      this.pendingFlushTimer = null;
    }

    this.watcher?.close();

    if (this.runPromise) {
      await this.runPromise;
    }

    this.resolveDone();
  }

  async handleWatchEvent(eventType, filename) {
    if (this.closed) {
      return;
    }

    if (!filename) {
      this.pendingRetry = true;
      this.scheduleFlush();
      return;
    }

    const relativePath = Buffer.isBuffer(filename) ? filename.toString("utf8") : filename;
    const changedPath = path.resolve(this.watchRoot, relativePath);

    if (this.shouldIgnorePath(changedPath)) {
      return;
    }

    this.pendingPaths.add(changedPath);
    this.scheduleFlush();
  }

  scheduleFlush() {
    if (this.pendingFlushTimer) {
      clearTimeout(this.pendingFlushTimer);
    }

    this.pendingFlushTimer = setTimeout(() => {
      this.pendingFlushTimer = null;
      void this.flushPendingChanges();
    }, this.debounceMs);
  }

  async flushPendingChanges() {
    if (this.closed) {
      return;
    }

    if (this.runPromise) {
      this.pendingRetry = true;
      return;
    }

    const changedPaths = [...this.pendingPaths].sort();
    const forceAllDocs = this.pendingRetry;
    const reloadGraph = changedPaths.some((filePath) => isConfigPath(this.graph, filePath));
    this.pendingPaths.clear();
    this.pendingRetry = false;

    if (changedPaths.length === 0 && !forceAllDocs) {
      return;
    }

    this.runPromise = this.processChanges(changedPaths, {
      forceAllDocs,
      reloadGraph,
      reason: "watch update",
    });

    try {
      await this.runPromise;
    } finally {
      this.runPromise = null;

      if (!this.closed && (this.pendingPaths.size > 0 || this.pendingRetry)) {
        this.scheduleFlush();
      }
    }
  }

  async processChanges(changedPaths, options = {}) {
    let activeGraph = this.graph;

    if (options.reloadGraph) {
      const reloadedGraph = await this.tryReloadGraph();
      if (!reloadedGraph) {
        return;
      }

      activeGraph = reloadedGraph;
    }

    const touchesInput = options.forceAllDocs || changedPaths.some((filePath) => isSameOrNestedPath(activeGraph.inputPath, filePath));
    const touchesShared =
      options.forceAllDocs ||
      this.sharedRegistryDirty ||
      changedPaths.some((filePath) => isSameOrNestedPath(activeGraph.projectSettings.sharedDir, filePath));

    let nextSourceDocs = activeGraph.sourceDocs;
    if (touchesInput || options.forceAllDocs) {
      nextSourceDocs = await discoverSourceDocs(activeGraph.inputPath, activeGraph.projectSettings);
    }

    const removedDocs = difference(activeGraph.sourceDocs, nextSourceDocs);
    const addedDocs = difference(nextSourceDocs, activeGraph.sourceDocs);

    let nextSharedDeclarations = activeGraph.sharedDeclarations;
    let sharedDiff = { changedFiles: new Set(), changedShortRefKeys: new Set() };

    if (touchesShared) {
      try {
        nextSharedDeclarations = await scanSharedDeclarations(activeGraph.projectSettings.sharedDir);
        sharedDiff = diffSharedDeclarations(activeGraph.sharedDeclarations, nextSharedDeclarations);
        replaceSharedDeclarations(activeGraph, nextSharedDeclarations);
        this.sharedRegistryDirty = false;
      } catch (error) {
        if (!(error instanceof MermaidIncludeError)) {
          throw error;
        }

        this.sharedRegistryDirty = true;
        this.logger.error(`Shared block scan failed: ${error.message}`);
      }
    }

    const removedOutputPaths = [];

    for (const docPath of removedDocs) {
      const outputPath = activeGraph.docStates.get(docPath)?.outputPath ?? getDocumentOutputPath(activeGraph, docPath);
      removedOutputPaths.push(outputPath);
      removeDocument(activeGraph, docPath);
    }

    setSourceDocs(activeGraph, nextSourceDocs);

    for (const outputPath of removedOutputPaths.sort()) {
      await removeFileIfExists(outputPath);
      this.logger.success(`Removed ${path.relative(this.cwd, outputPath)}`);
    }

    const affectedDocs = new Set(activeGraph.dirtyDocs);

    if (options.forceAllDocs || this.sharedRegistryDirty) {
      addAll(affectedDocs, activeGraph.sourceDocs);
    }

    addAll(affectedDocs, addedDocs);

    for (const changedPath of changedPaths) {
      if (activeGraph.sourceDocs.has(changedPath)) {
        affectedDocs.add(changedPath);
      }

      addAll(affectedDocs, activeGraph.docsByResolvedFilePath.get(changedPath));
    }

    for (const filePath of sharedDiff.changedFiles) {
      addAll(affectedDocs, activeGraph.docsByResolvedFilePath.get(filePath));
    }

    for (const shortRefKey of sharedDiff.changedShortRefKeys) {
      addAll(affectedDocs, activeGraph.docsByShortRefKey.get(shortRefKey));
    }

    if (affectedDocs.size === 0) {
      return;
    }

    await this.rebuildDocuments([...affectedDocs].sort(), options.reason ?? "watch update");
  }

  async rebuildDocuments(docPaths, reason) {
    const activeGraph = this.graph;
    const stagedOutputs = [];
    let builtCount = 0;

    for (const docPath of docPaths) {
      if (activeGraph.sourceDocs.has(docPath)) {
        markDocumentDirty(activeGraph, docPath);
      }
    }

    for (const docPath of docPaths) {
      if (!activeGraph.sourceDocs.has(docPath)) {
        continue;
      }

      try {
        const artifact = await buildDocumentArtifacts(docPath, {
          cwd: this.cwd,
          maxIncludeDepth: this.maxIncludeDepth,
          projectSettings: activeGraph.projectSettings,
        });

        if (this.validate) {
          await validateMarkdownMermaid(artifact.output, { filePath: docPath });
        }

        upsertDocumentState(activeGraph, docPath, artifact.dependencies);
        stagedOutputs.push({
          filePath: docPath,
          outputPath: getDocumentOutputPath(activeGraph, docPath),
          output: artifact.output,
        });
        builtCount += 1;
      } catch (error) {
        if (!(error instanceof MermaidIncludeError)) {
          throw error;
        }

        this.logger.error(`Build failed in ${path.relative(this.cwd, docPath)}: ${error.message}`);
        return;
      }
    }

    for (const entry of stagedOutputs) {
      await writeTextFile(entry.outputPath, entry.output);
    }

    if (builtCount === 1) {
      this.logger.success(`Rebuilt ${path.relative(this.cwd, stagedOutputs[0].outputPath)} (${reason})`);
      return;
    }

    this.logger.success(`Rebuilt ${builtCount} Markdown file(s) (${reason})`);
  }

  async tryReloadGraph() {
    try {
      const nextGraph = await createProjectGraph({
        cwd: this.cwd,
        inputArg: this.inputArg,
        outputArg: this.outputArg,
      });
      this.graph = nextGraph;
      this.sharedRegistryDirty = false;
      return nextGraph;
    } catch (error) {
      if (!(error instanceof MermaidIncludeError)) {
        throw error;
      }

      this.pendingRetry = true;
      this.logger.error(`Config reload failed: ${error.message}`);
      return null;
    }
  }

  shouldIgnorePath(filePath) {
    if (isSameOrNestedPath(this.graph.outputBaseDir, filePath)) {
      return true;
    }

    if (this.graph.docsByResolvedFilePath.has(filePath)) {
      return false;
    }

    return !isConfigPath(this.graph, filePath)
      && !isSameOrNestedPath(this.graph.inputPath, filePath)
      && !isSameOrNestedPath(this.graph.projectSettings.sharedDir, filePath);
  }
}

async function createProjectGraph(options) {
  const projectSettings = await loadProjectSettings(options.inputArg ?? options.cwd, { cwd: options.cwd });
  const inputPath = path.resolve(options.inputArg ?? projectSettings.docsDir);
  const inputStats = await statInputPath(inputPath, options.cwd);

  if (!inputStats.isDirectory()) {
    throw new MermaidIncludeError("mdmm dev currently supports a directory input only", {
      code: "INVALID_DEV_INPUT",
    });
  }

  return createDependencyGraph({
    cwd: options.cwd,
    inputPath,
    outputBaseDir: path.resolve(options.outputArg ?? projectSettings.outputDir),
    projectSettings,
  });
}

function difference(left, right) {
  const result = new Set();

  for (const value of left) {
    if (!right.has(value)) {
      result.add(value);
    }
  }

  return result;
}

function addAll(target, values) {
  if (!values) {
    return;
  }

  for (const value of values) {
    target.add(value);
  }
}

function isConfigPath(graph, filePath) {
  return filePath === path.join(graph.projectSettings.baseDir, CONFIG_FILE_NAME);
}
