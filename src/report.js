import { readFile } from "node:fs/promises";
import path from "node:path";

import { MermaidIncludeError } from "./errors.js";
import { loadProjectSettings } from "./project.js";
import { resolveBlockReference, resolveReferenceText } from "./references.js";

const WHOLE_INCLUDE_PATTERN = /```mermaid-include[^\n]*\r?\n([\s\S]*?)\r?\n```/g;
const FRAGMENT_INCLUDE_PATTERN = /^\s*%%\s*include:\s+(\S+)(?:\s+as\s+([A-Za-z][A-Za-z0-9_-]*))?\s*$/gm;

export async function buildDependencyReport(filePaths, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const rootPath = options.rootPath ?? cwd;
  const projectSettings = options.projectSettings ?? (await loadProjectSettings(rootPath, { cwd }));
  const files = [];
  const blockUsage = new Map();
  const context = {
    projectSettings,
    sharedBlockIndexPromise: null,
  };

  for (const filePath of [...filePaths].sort()) {
    const markdown = await readUtf8(filePath);
    const dependencies = await collectFileDependencies(markdown, filePath, context);

    files.push({
      path: path.relative(cwd, filePath),
      dependencyCount: dependencies.length,
      dependencies: dependencies.map((dependency) => formatDependency(dependency, cwd)),
    });

    for (const dependency of dependencies) {
      const blockKey = `${dependency.resolvedFilePath}#${dependency.blockId}`;
      if (!blockUsage.has(blockKey)) {
        blockUsage.set(blockKey, {
          target: path.relative(cwd, dependency.resolvedFilePath),
          blockId: dependency.blockId,
          usedBy: [],
        });
      }

      blockUsage.get(blockKey).usedBy.push({
        path: path.relative(cwd, filePath),
        type: dependency.type,
        alias: dependency.alias ?? null,
        reference: dependency.reference,
      });
    }
  }

  const blocks = [...blockUsage.values()]
    .map((entry) => ({
      target: entry.target,
      blockId: entry.blockId,
      useCount: entry.usedBy.length,
      usedBy: entry.usedBy.sort(comparePathEntries),
    }))
    .sort((left, right) => {
      const leftKey = `${left.target}#${left.blockId}`;
      const rightKey = `${right.target}#${right.blockId}`;
      return leftKey.localeCompare(rightKey);
    });

  return {
    generatedAt: new Date().toISOString(),
    rootPath: path.relative(cwd, rootPath),
    summary: {
      fileCount: files.length,
      dependencyCount: files.reduce((sum, file) => sum + file.dependencyCount, 0),
      blockCount: blocks.length,
    },
    files,
    blocks,
  };
}

export async function collectFileDependencies(markdown, currentFilePath, context) {
  const dependencies = [];

  for (const match of markdown.matchAll(WHOLE_INCLUDE_PATTERN)) {
    const reference = await resolveBlockReference(match[1], currentFilePath, "mermaid-include", context);
    dependencies.push({
      type: "diagram",
      reference: reference.referenceText,
      resolvedFilePath: reference.filePath,
      blockId: reference.blockId,
      alias: null,
    });
  }

  for (const match of markdown.matchAll(FRAGMENT_INCLUDE_PATTERN)) {
    if (!match[2]) {
      throw new MermaidIncludeError(
        `Fragment include is missing alias in ${path.relative(process.cwd(), currentFilePath)}: ${match[0].trim()}`,
        {
          code: "MISSING_ALIAS",
        },
      );
    }

    const reference = await resolveReferenceText(match[1], currentFilePath, "fragment include", context);
    dependencies.push({
      type: "fragment",
      reference: reference.referenceText,
      resolvedFilePath: reference.filePath,
      blockId: reference.blockId,
      alias: match[2],
    });
  }

  return dependencies;
}

function formatDependency(dependency, cwd) {
  return {
    type: dependency.type,
    reference: dependency.reference,
    target: path.relative(cwd, dependency.resolvedFilePath),
    blockId: dependency.blockId,
    alias: dependency.alias,
  };
}
async function readUtf8(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new MermaidIncludeError(`Referenced file not found: ${path.relative(process.cwd(), filePath)}`, {
        code: "MISSING_FILE",
        filePath,
      });
    }

    throw error;
  }
}

function comparePathEntries(left, right) {
  if (left.path !== right.path) {
    return left.path.localeCompare(right.path);
  }

  if ((left.alias ?? "") !== (right.alias ?? "")) {
    return (left.alias ?? "").localeCompare(right.alias ?? "");
  }

  return left.reference.localeCompare(right.reference);
}
