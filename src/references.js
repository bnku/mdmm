import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { extractBlocks } from "./blocks.js";
import { MermaidIncludeError } from "./errors.js";

export async function resolveBlockReference(rawReference, currentFilePath, sourceName, context) {
  const lines = rawReference
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length !== 1) {
    throw new MermaidIncludeError(
      `Each ${sourceName} block must contain exactly one non-empty reference in ${path.relative(process.cwd(), currentFilePath)}`,
      {
        code: "INVALID_INCLUDE_DIRECTIVE",
      },
    );
  }

  return resolveReferenceText(lines[0], currentFilePath, sourceName, context);
}

export async function resolveReferenceText(referenceText, currentFilePath, sourceName, context) {
  const trimmedReference = referenceText.trim();
  const separatorIndex = trimmedReference.lastIndexOf("#");

  if (separatorIndex !== -1) {
    return parseExplicitReference(trimmedReference, currentFilePath, sourceName);
  }

  if (!trimmedReference) {
    throwInvalidReference(referenceText, currentFilePath, sourceName);
  }

  return resolveShortReference(trimmedReference, currentFilePath, context);
}

async function resolveShortReference(blockId, currentFilePath, context) {
  const matches = (await loadSharedBlockIndex(context)).get(blockId) ?? [];

  if (matches.length === 0) {
    throw new MermaidIncludeError(
      `Block ${blockId} not found in ${path.relative(process.cwd(), context.projectSettings.sharedDir)} while resolving ${path.relative(process.cwd(), currentFilePath)}`,
      {
        code: "MISSING_BLOCK",
        blockKey: blockId,
      },
    );
  }

  if (matches.length > 1) {
    const candidatePaths = matches.map((match) => path.relative(process.cwd(), match.filePath)).join(", ");
    throw new MermaidIncludeError(`Short reference ${blockId} is ambiguous: ${candidatePaths}`, {
      code: "AMBIGUOUS_BLOCK_REFERENCE",
      blockId,
      matches: matches.map((match) => match.filePath),
    });
  }

  return {
    filePath: matches[0].filePath,
    blockId,
    referenceText: blockId,
  };
}

function parseExplicitReference(referenceText, currentFilePath, sourceName) {
  const separatorIndex = referenceText.lastIndexOf("#");
  const filePart = referenceText.slice(0, separatorIndex).trim();
  const blockId = referenceText.slice(separatorIndex + 1).trim();

  if (!filePart || !blockId) {
    throwInvalidReference(referenceText, currentFilePath, sourceName);
  }

  return {
    filePath: path.resolve(path.dirname(currentFilePath), filePart),
    blockId,
    referenceText,
  };
}

function throwInvalidReference(referenceText, currentFilePath, sourceName) {
  throw new MermaidIncludeError(
    `Invalid ${sourceName} reference ${JSON.stringify(referenceText)} in ${path.relative(process.cwd(), currentFilePath)}. Expected <block-id> or ./path/to/file.md#block-id`,
    {
      code: "INVALID_INCLUDE_REFERENCE",
    },
  );
}

async function loadSharedBlockIndex(context) {
  if (!context.sharedBlockIndexPromise) {
    context.sharedBlockIndexPromise = buildSharedBlockIndex(context.projectSettings.sharedDir);
  }

  return context.sharedBlockIndexPromise;
}

async function buildSharedBlockIndex(sharedDir) {
  const markdownFiles = await listMarkdownFiles(sharedDir);
  const index = new Map();

  for (const filePath of markdownFiles) {
    const markdown = await readFile(filePath, "utf8");
    const blocks = extractBlocks(markdown, filePath);

    for (const [blockId] of blocks) {
      if (!index.has(blockId)) {
        index.set(blockId, []);
      }

      index.get(blockId).push({ filePath });
    }
  }

  return index;
}

async function listMarkdownFiles(rootDir) {
  try {
    const rootStats = await stat(rootDir);
    if (!rootStats.isDirectory()) {
      return [];
    }
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const entries = await readdir(rootDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(entryPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(entryPath);
    }
  }

  return files;
}
