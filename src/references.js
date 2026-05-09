import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { extractBlocks } from "./blocks.js";
import { MermaidIncludeError } from "./errors.js";
import { listMarkdownFiles } from "./files.js";
import { parseDiagramIncludeDirective } from "./include-parser.js";

export async function resolveBlockReference(rawReference, currentFilePath, sourceName, context) {
  const directive = parseDiagramIncludeDirective(rawReference, currentFilePath, sourceName);
  const reference = await resolveReferenceText(directive.referenceText, currentFilePath, sourceName, context);
  return {
    ...reference,
    args: directive.args,
    invocationFilePath: currentFilePath,
  };
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
    referenceKind: "short",
    shortBlockId: blockId,
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

    for (const [blockId] of blocks) {
      if (!index.has(blockId)) {
        index.set(blockId, []);
      }

      index.get(blockId).push({ filePath });
    }
  }

  return index;
}
