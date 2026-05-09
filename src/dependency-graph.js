import { readFile } from "node:fs/promises";
import path from "node:path";

import { extractBlocks } from "./blocks.js";
import { getIgnoredDirs, listMarkdownFiles } from "./files.js";

export function createDependencyGraph(options = {}) {
  return {
    cwd: options.cwd,
    inputPath: options.inputPath,
    outputBaseDir: options.outputBaseDir,
    projectSettings: options.projectSettings,
    sourceDocs: new Set(),
    dirtyDocs: new Set(),
    docStates: new Map(),
    sharedDeclarations: new Map(),
    docsByResolvedBlockKey: new Map(),
    docsByResolvedFilePath: new Map(),
    docsByShortRefBlockId: new Map(),
  };
}

export async function discoverSourceDocs(inputPath, projectSettings) {
  return new Set(
    await listMarkdownFiles(inputPath, {
      ignoredDirs: getIgnoredDirs(inputPath, projectSettings),
      allowMissing: true,
    }),
  );
}

export async function scanSharedDeclarations(sharedDir) {
  const markdownFiles = await listMarkdownFiles(sharedDir, { allowMissing: true });
  const declarations = new Map();

  for (const filePath of markdownFiles) {
    const markdown = await readFile(filePath, "utf8");
    const blocks = extractBlocks(markdown, filePath);
    declarations.set(filePath, {
      blockIds: new Set(blocks.keys()),
    });
  }

  return declarations;
}

export function setSourceDocs(graph, docPaths) {
  graph.sourceDocs = new Set([...docPaths].sort());
}

export function getDocumentOutputPath(graph, docPath) {
  return path.join(graph.outputBaseDir, path.relative(graph.inputPath, docPath));
}

export function markDocumentDirty(graph, docPath) {
  removeDocumentState(graph, docPath);
  if (graph.sourceDocs.has(docPath)) {
    graph.dirtyDocs.add(docPath);
  }
}

export function removeDocument(graph, docPath) {
  removeDocumentState(graph, docPath);
  graph.sourceDocs.delete(docPath);
  graph.dirtyDocs.delete(docPath);
}

export function upsertDocumentState(graph, docPath, dependencies) {
  removeDocumentState(graph, docPath);

  const state = {
    docPath,
    outputPath: getDocumentOutputPath(graph, docPath),
    dependencies,
    resolvedBlockKeys: new Set(),
    resolvedFilePaths: new Set(),
    shortRefBlockIds: new Set(),
  };

  for (const dependency of dependencies) {
    const blockKey = formatBlockKey(dependency.resolvedFilePath, dependency.blockId);
    state.resolvedBlockKeys.add(blockKey);
    state.resolvedFilePaths.add(dependency.resolvedFilePath);

    if (dependency.shortBlockId) {
      state.shortRefBlockIds.add(dependency.shortBlockId);
    }
  }

  graph.docStates.set(docPath, state);
  graph.dirtyDocs.delete(docPath);

  for (const blockKey of state.resolvedBlockKeys) {
    addIndexEntry(graph.docsByResolvedBlockKey, blockKey, docPath);
  }

  for (const filePath of state.resolvedFilePaths) {
    addIndexEntry(graph.docsByResolvedFilePath, filePath, docPath);
  }

  for (const blockId of state.shortRefBlockIds) {
    addIndexEntry(graph.docsByShortRefBlockId, blockId, docPath);
  }
}

export function replaceSharedDeclarations(graph, declarations) {
  graph.sharedDeclarations = declarations;
}

export function diffSharedDeclarations(previousDeclarations, nextDeclarations) {
  const changedFiles = new Set();
  const changedBlockIds = new Set();
  const allFiles = new Set([...previousDeclarations.keys(), ...nextDeclarations.keys()]);

  for (const filePath of allFiles) {
    const previous = previousDeclarations.get(filePath)?.blockIds ?? new Set();
    const next = nextDeclarations.get(filePath)?.blockIds ?? new Set();

    if (setsAreEqual(previous, next)) {
      continue;
    }

    changedFiles.add(filePath);

    for (const blockId of previous) {
      changedBlockIds.add(blockId);
    }

    for (const blockId of next) {
      changedBlockIds.add(blockId);
    }
  }

  return {
    changedFiles,
    changedBlockIds,
  };
}

function removeDocumentState(graph, docPath) {
  const previousState = graph.docStates.get(docPath);
  if (!previousState) {
    return;
  }

  for (const blockKey of previousState.resolvedBlockKeys) {
    removeIndexEntry(graph.docsByResolvedBlockKey, blockKey, docPath);
  }

  for (const filePath of previousState.resolvedFilePaths) {
    removeIndexEntry(graph.docsByResolvedFilePath, filePath, docPath);
  }

  for (const blockId of previousState.shortRefBlockIds) {
    removeIndexEntry(graph.docsByShortRefBlockId, blockId, docPath);
  }

  graph.docStates.delete(docPath);
}

function addIndexEntry(index, key, docPath) {
  if (!index.has(key)) {
    index.set(key, new Set());
  }

  index.get(key).add(docPath);
}

function removeIndexEntry(index, key, docPath) {
  const docPaths = index.get(key);
  if (!docPaths) {
    return;
  }

  docPaths.delete(docPath);
  if (docPaths.size === 0) {
    index.delete(key);
  }
}

function formatBlockKey(filePath, blockId) {
  return `${filePath}#${blockId}`;
}

function setsAreEqual(left, right) {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
}
