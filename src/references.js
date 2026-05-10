import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { extractBlocks } from "./blocks.js";
import { MermaidIncludeError } from "./errors.js";
import { listMarkdownFiles } from "./files.js";
import { parseBlockIncludeDirective } from "./include-parser.js";

export async function resolveBlockReference(rawReference, currentFilePath, sourceName, context, expectedType = "diagram") {
  const directive = parseBlockIncludeDirective(rawReference, currentFilePath, sourceName);
  const reference = await resolveReferenceText(directive.referenceText, currentFilePath, sourceName, context, expectedType);
  return {
    ...reference,
    args: directive.args,
    invocationFilePath: currentFilePath,
  };
}

export async function resolveReferenceText(referenceText, currentFilePath, sourceName, context, expectedType = "diagram") {
  const trimmedReference = referenceText.trim();
  const separatorIndex = trimmedReference.lastIndexOf("#");

  if (separatorIndex !== -1) {
    return parseExplicitReference(trimmedReference, currentFilePath, sourceName);
  }

  if (!trimmedReference) {
    throwInvalidReference(referenceText, currentFilePath, sourceName);
  }

  return resolveShortReference(trimmedReference, currentFilePath, context, expectedType);
}

async function resolveShortReference(blockId, currentFilePath, context, expectedType) {
  const shortRefKey = formatShortRefKey(expectedType, blockId);
  const matches = (await loadSharedBlockIndex(context)).get(shortRefKey) ?? [];

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
    referenceKind: "short",
    shortBlockId: blockId,
    shortBlockType: expectedType,
    shortRefKey,
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
    referenceKind: "explicit",
    shortBlockId: null,
    shortBlockType: null,
    shortRefKey: null,
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
  const markdownFiles = await listMarkdownFiles(sharedDir, { allowMissing: true });
  const index = new Map();

  for (const filePath of markdownFiles) {
    const markdown = await readFile(filePath, "utf8");
    const blocks = extractBlocks(markdown, filePath);

    for (const [blockId, block] of blocks) {
      const shortRefKey = formatShortRefKey(block.type, blockId);
      if (!index.has(shortRefKey)) {
        index.set(shortRefKey, []);
      }

      index.get(shortRefKey).push({ filePath });
    }
  }

  return index;
}

function formatShortRefKey(blockType, blockId) {
  return `${blockType}:${blockId}`;
}
