import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const INCLUDE_BLOCK_PATTERN = /```mermaid-include[^\n]*\r?\n([\s\S]*?)\r?\n```/g;
const BLOCK_PATTERN = /<!--\s*mermaid:block\s+([A-Za-z0-9._-]+)([^>]*)-->\s*([\s\S]*?)\s*<!--\s*\/mermaid:block\s*-->/g;
const MERMAID_FENCE_PATTERN = /```mermaid(?!-)([^\n]*)\r?\n([\s\S]*?)\r?\n```/g;
const FRAGMENT_INCLUDE_PATTERN = /^\s*%%\s*include:\s+(\S+)(?:\s+as\s+([A-Za-z][A-Za-z0-9_-]*))?\s*$/;
const MERMAID_INCLUDE_SENTINEL = "```mermaid-include";
const FRAGMENT_INCLUDE_SENTINEL = /(^|\n)\s*%%\s*include:/m;

export class MermaidIncludeError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "MermaidIncludeError";
    this.details = details;
  }
}

export async function preprocessMarkdown(markdown, options) {
  const inputPath = path.resolve(options.inputPath);
  const context = {
    maxIncludeDepth: options.maxIncludeDepth ?? 5,
    fileCache: new Map(),
  };

  const output = await resolveMarkdown(markdown, inputPath, context, []);
  assertNoUnresolvedDirectives(output, inputPath);
  return output;
}

export async function preprocessFile(inputPath, outputPath, options = {}) {
  const absoluteInputPath = path.resolve(inputPath);
  const markdown = await readUtf8(absoluteInputPath);
  const output = await preprocessMarkdown(markdown, {
    ...options,
    inputPath: absoluteInputPath,
  });

  if (outputPath) {
    const absoluteOutputPath = path.resolve(outputPath);
    await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
    await writeFile(absoluteOutputPath, output, "utf8");
  }

  return output;
}

async function resolveMarkdown(markdown, currentFilePath, context, stack) {
  const withWholeDiagramIncludes = await replaceAsync(markdown, INCLUDE_BLOCK_PATTERN, async (match, rawReference) => {
    const reference = parseBlockReference(rawReference, currentFilePath, "mermaid-include");
    return resolveDiagramBlockReference(reference, context, stack);
  });

  return replaceAsync(withWholeDiagramIncludes, MERMAID_FENCE_PATTERN, async (match, infoSuffix, body) => {
    const resolvedBody = await resolveFragmentIncludesInCode(body, currentFilePath, context, stack);
    return buildFence("mermaid", infoSuffix, resolvedBody);
  });
}

async function resolveDiagramBlockReference(reference, context, stack) {
  const block = await getBlock(reference, context, "diagram");

  if (!block.resolvedDiagramContent) {
    const nextStack = pushBlockToStack(reference, stack, context.maxIncludeDepth);
    const expanded = await resolveMarkdown(block.rawContent, reference.filePath, context, nextStack);
    const trimmedExpanded = expanded.trim();
    extractFence(trimmedExpanded, "mermaid", reference.filePath, reference.blockId);
    assertNoUnresolvedDirectives(trimmedExpanded, reference.filePath, reference.blockId);
    block.resolvedDiagramContent = trimmedExpanded;
  }

  return block.resolvedDiagramContent;
}

async function resolveFragmentBlockReference(reference, context, stack) {
  const block = await getBlock(reference, context, "fragment");

  if (!block.resolvedFragment) {
    const nextStack = pushBlockToStack(reference, stack, context.maxIncludeDepth);
    const fragmentFence = extractFence(block.rawContent.trim(), "mermaid-fragment", reference.filePath, reference.blockId);
    const resolvedBody = await resolveFragmentIncludesInCode(fragmentFence.body, reference.filePath, context, nextStack);
    const trimmedBody = resolvedBody.trim();

    assertNoUnresolvedDirectives(trimmedBody, reference.filePath, reference.blockId);

    const nodeIds = extractDefinedNodeIds(trimmedBody);
    validateExports(block, nodeIds, reference);

    block.resolvedFragment = {
      body: trimmedBody,
      nodeIds,
      exports: block.exports,
    };
  }

  return block.resolvedFragment;
}

async function resolveFragmentIncludesInCode(body, currentFilePath, context, stack) {
  const lines = body.split(/\r?\n/);
  const nonDirectiveBody = lines.filter((line) => !line.trim().startsWith("%% include:")).join("\n");
  const usedAliases = new Set();
  const outputLines = [];

  for (const line of lines) {
    const directive = parseFragmentIncludeDirective(line, currentFilePath);

    if (!directive) {
      outputLines.push(line);
      continue;
    }

    if (usedAliases.has(directive.alias)) {
      throw new MermaidIncludeError(
        `Duplicate fragment alias ${directive.alias} in ${path.relative(process.cwd(), currentFilePath)}`,
        {
          code: "DUPLICATE_ALIAS",
          alias: directive.alias,
        },
      );
    }

    const fragment = await resolveFragmentBlockReference(directive.reference, context, stack);
    validateExternalAliasReferences(nonDirectiveBody, directive.alias, fragment.exports, currentFilePath);
    usedAliases.add(directive.alias);
    outputLines.push(rewriteFragmentBody(fragment.body, directive.alias, fragment.nodeIds));
  }

  return outputLines.join("\n");
}

async function getBlock(reference, context, expectedType) {
  const fileRecord = await loadFileRecord(reference.filePath, context);
  const block = fileRecord.blocks.get(reference.blockId);

  if (!block) {
    throw new MermaidIncludeError(
      `Block ${reference.blockId} not found in ${path.relative(process.cwd(), reference.filePath)}`,
      {
        code: "MISSING_BLOCK",
        blockKey: formatReference(reference),
      },
    );
  }

  if (block.type !== expectedType) {
    throw new MermaidIncludeError(
      `Block ${reference.blockId} in ${path.relative(process.cwd(), reference.filePath)} has type ${block.type}, expected ${expectedType}`,
      {
        code: "INVALID_BLOCK_TYPE",
        blockKey: formatReference(reference),
        expectedType,
        actualType: block.type,
      },
    );
  }

  return block;
}

async function loadFileRecord(filePath, context) {
  if (context.fileCache.has(filePath)) {
    return context.fileCache.get(filePath);
  }

  const markdown = await readUtf8(filePath);
  const blocks = extractBlocks(markdown, filePath);
  const record = { markdown, blocks };
  context.fileCache.set(filePath, record);
  return record;
}

function extractBlocks(markdown, filePath) {
  const blocks = new Map();

  for (const match of markdown.matchAll(BLOCK_PATTERN)) {
    const blockId = match[1];
    const attributes = parseBlockAttributes(match[2] ?? "");
    const rawContent = match[3].trim();

    if (blocks.has(blockId)) {
      throw new MermaidIncludeError(
        `Duplicate block id ${blockId} found in ${path.relative(process.cwd(), filePath)}`,
        {
          code: "DUPLICATE_BLOCK_ID",
          blockId,
        },
      );
    }

    blocks.set(blockId, {
      blockId,
      filePath,
      type: attributes.type ?? "diagram",
      exports: attributes.exports ?? [],
      rawContent,
      resolvedDiagramContent: null,
      resolvedFragment: null,
    });
  }

  return blocks;
}

function parseBlockAttributes(rawAttributes) {
  const attributes = {};
  const tokens = rawAttributes.trim().split(/\s+/).filter(Boolean);

  for (const token of tokens) {
    const separatorIndex = token.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = token.slice(0, separatorIndex);
    const value = token.slice(separatorIndex + 1);

    if (key === "type") {
      attributes.type = value;
      continue;
    }

    if (key === "exports") {
      attributes.exports = value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }

  return attributes;
}

function parseBlockReference(rawReference, currentFilePath, sourceName) {
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

  return parseSingleReference(lines[0], currentFilePath, sourceName);
}

function parseSingleReference(referenceText, currentFilePath, sourceName) {
  const separatorIndex = referenceText.lastIndexOf("#");
  if (separatorIndex === -1) {
    throw new MermaidIncludeError(
      `Invalid ${sourceName} reference ${JSON.stringify(referenceText)} in ${path.relative(process.cwd(), currentFilePath)}. Expected ./path/to/file.md#block-id`,
      {
        code: "INVALID_INCLUDE_REFERENCE",
      },
    );
  }

  const filePart = referenceText.slice(0, separatorIndex).trim();
  const blockId = referenceText.slice(separatorIndex + 1).trim();

  if (!filePart || !blockId) {
    throw new MermaidIncludeError(
      `Invalid ${sourceName} reference ${JSON.stringify(referenceText)} in ${path.relative(process.cwd(), currentFilePath)}. Expected ./path/to/file.md#block-id`,
      {
        code: "INVALID_INCLUDE_REFERENCE",
      },
    );
  }

  return {
    filePath: path.resolve(path.dirname(currentFilePath), filePart),
    blockId,
  };
}

function parseFragmentIncludeDirective(line, currentFilePath) {
  const trimmed = line.trim();

  if (!trimmed.startsWith("%% include:")) {
    return null;
  }

  const match = trimmed.match(FRAGMENT_INCLUDE_PATTERN);
  if (!match) {
    throw new MermaidIncludeError(
      `Invalid fragment include directive in ${path.relative(process.cwd(), currentFilePath)}: ${trimmed}`,
      {
        code: "INVALID_FRAGMENT_INCLUDE_DIRECTIVE",
      },
    );
  }

  if (!match[2]) {
    throw new MermaidIncludeError(
      `Fragment include is missing alias in ${path.relative(process.cwd(), currentFilePath)}: ${trimmed}`,
      {
        code: "MISSING_ALIAS",
      },
    );
  }

  return {
    reference: parseSingleReference(match[1], currentFilePath, "fragment include"),
    alias: match[2],
  };
}

function validateExports(block, nodeIds, reference) {
  for (const exportName of block.exports) {
    if (!nodeIds.has(exportName)) {
      throw new MermaidIncludeError(
        `Export ${exportName} is not defined in fragment ${formatReference(reference)}`,
        {
          code: "MISSING_EXPORT",
          exportName,
          blockKey: formatReference(reference),
        },
      );
    }
  }
}

function validateExternalAliasReferences(body, alias, exportsList, currentFilePath) {
  const exportSet = new Set(exportsList);
  const referencePattern = new RegExp(`\\b${escapeRegExp(alias)}__([A-Za-z][A-Za-z0-9_]*)\\b`, "g");

  for (const match of body.matchAll(referencePattern)) {
    const exportName = match[1];
    if (!exportSet.has(exportName)) {
      throw new MermaidIncludeError(
        `Alias ${alias} references non-exported node ${exportName} in ${path.relative(process.cwd(), currentFilePath)}`,
        {
          code: "MISSING_EXPORT",
          alias,
          exportName,
        },
      );
    }
  }
}

function rewriteFragmentBody(body, alias, nodeIds) {
  return body
    .split(/\r?\n/)
    .map((line) => rewriteFragmentLine(line, alias, nodeIds))
    .join("\n");
}

function rewriteFragmentLine(line, alias, nodeIds) {
  if (line.trim().startsWith("%%")) {
    return line;
  }

  let output = "";
  let index = 0;
  let quote = null;
  let edgeLabelDepth = 0;
  const bracketStack = [];

  while (index < line.length) {
    const character = line[index];

    if (quote) {
      output += character;
      if (character === quote && line[index - 1] !== "\\") {
        quote = null;
      }
      index += 1;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      output += character;
      index += 1;
      continue;
    }

    if (character === "|") {
      edgeLabelDepth = edgeLabelDepth === 0 ? 1 : 0;
      output += character;
      index += 1;
      continue;
    }

    if (edgeLabelDepth === 0) {
      if (character === "[" || character === "(" || character === "{") {
        bracketStack.push(getClosingBracket(character));
        output += character;
        index += 1;
        continue;
      }

      const topBracket = bracketStack[bracketStack.length - 1];
      if (topBracket && character === topBracket) {
        bracketStack.pop();
        output += character;
        index += 1;
        continue;
      }
    }

    if (edgeLabelDepth === 0 && bracketStack.length === 0 && isIdentifierStart(character)) {
      let end = index + 1;
      while (end < line.length && isIdentifierPart(line[end])) {
        end += 1;
      }

      const token = line.slice(index, end);
      output += nodeIds.has(token) ? `${alias}__${token}` : token;
      index = end;
      continue;
    }

    output += character;
    index += 1;
  }

  return output;
}

function extractDefinedNodeIds(body) {
  const nodeIds = new Set();
  const definitionPattern = /(^|[^A-Za-z0-9_])([A-Za-z][A-Za-z0-9_]*)(?=\s*[\[{(])/g;

  for (const line of body.split(/\r?\n/)) {
    if (line.trim().startsWith("%%")) {
      continue;
    }

    for (const match of line.matchAll(definitionPattern)) {
      nodeIds.add(match[2]);
    }
  }

  return nodeIds;
}

function extractFence(markdown, language, filePath, blockId) {
  const lines = markdown.split(/\r?\n/);
  const prefix = `\`\`\`${language}`;

  if (lines.length < 2 || !lines[0].startsWith(prefix) || lines.at(-1) !== "```") {
    throw new MermaidIncludeError(
      `Block ${blockId} in ${path.relative(process.cwd(), filePath)} must resolve to exactly one ${language} code fence`,
      {
        code: "INVALID_BLOCK_CONTENT",
        language,
      },
    );
  }

  if (language === "mermaid" && lines[0].startsWith("```mermaid-")) {
    throw new MermaidIncludeError(
      `Block ${blockId} in ${path.relative(process.cwd(), filePath)} must resolve to exactly one ${language} code fence`,
      {
        code: "INVALID_BLOCK_CONTENT",
        language,
      },
    );
  }

  return {
    infoSuffix: lines[0].slice(prefix.length),
    body: lines.slice(1, -1).join("\n"),
  };
}

function buildFence(language, infoSuffix, body) {
  return `\`\`\`${language}${infoSuffix}\n${body.trim()}\n\`\`\``;
}

function pushBlockToStack(reference, stack, maxIncludeDepth) {
  const blockKey = formatReference(reference);

  if (stack.includes(blockKey)) {
    const chain = [...stack, blockKey].join(" -> ");
    throw new MermaidIncludeError(`Cyclic include detected: ${chain}`, {
      code: "CYCLIC_INCLUDE",
      blockKey,
    });
  }

  if (stack.length >= maxIncludeDepth) {
    throw new MermaidIncludeError(
      `Maximum include depth ${maxIncludeDepth} exceeded while resolving ${blockKey}`,
      {
        code: "MAX_INCLUDE_DEPTH_EXCEEDED",
        blockKey,
      },
    );
  }

  return [...stack, blockKey];
}

function assertNoUnresolvedDirectives(markdown, filePath, blockId) {
  const target = blockId
    ? `block ${blockId} in ${path.relative(process.cwd(), filePath)}`
    : path.relative(process.cwd(), filePath);

  if (markdown.includes(MERMAID_INCLUDE_SENTINEL)) {
    throw new MermaidIncludeError(`Unresolved mermaid-include directive left in ${target}`, {
      code: "UNRESOLVED_DIRECTIVE",
    });
  }

  if (FRAGMENT_INCLUDE_SENTINEL.test(markdown)) {
    throw new MermaidIncludeError(`Unresolved fragment include directive left in ${target}`, {
      code: "UNRESOLVED_FRAGMENT_INCLUDE",
    });
  }
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

async function replaceAsync(input, pattern, replacer) {
  let output = "";
  let lastIndex = 0;

  for (const match of input.matchAll(pattern)) {
    const [fullMatch, ...groups] = match;
    const start = match.index ?? 0;
    output += input.slice(lastIndex, start);
    output += await replacer(fullMatch, ...groups, start, input);
    lastIndex = start + fullMatch.length;
  }

  output += input.slice(lastIndex);
  return output;
}

function formatReference(reference) {
  return `${path.relative(process.cwd(), reference.filePath)}#${reference.blockId}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isIdentifierStart(character) {
  return /[A-Za-z]/.test(character);
}

function isIdentifierPart(character) {
  return /[A-Za-z0-9_]/.test(character);
}

function getClosingBracket(openingBracket) {
  if (openingBracket === "[") {
    return "]";
  }

  if (openingBracket === "(") {
    return ")";
  }

  return "}";
}
