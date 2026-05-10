import path from "node:path";
import process from "node:process";

import { MermaidIncludeError } from "./errors.js";

const BLOCK_ID_PATTERN = "[A-Za-z0-9._-]+";
const DECLARATION_NAME_PATTERN = "mermaid:block|mm:block|markdown:block|md:block|mermaid:fragment|mm:fragment";
const OPEN_DECLARATION_PATTERN = new RegExp(
  `<!--\\s*(${DECLARATION_NAME_PATTERN})\\s+(${BLOCK_ID_PATTERN})([^>]*)-->`,
  "g",
);
const CLOSE_DECLARATION_PATTERN = new RegExp(`<!--\\s*\/(${DECLARATION_NAME_PATTERN})\\s*-->`, "g");

const DECLARATION_TYPES = {
  "mermaid:block": "diagram",
  "mm:block": "diagram",
  "markdown:block": "markdown",
  "md:block": "markdown",
  "mermaid:fragment": "fragment",
  "mm:fragment": "fragment",
};

export function extractBlocks(markdown, filePath) {
  const blocks = new Map();
  OPEN_DECLARATION_PATTERN.lastIndex = 0;

  while (true) {
    const match = OPEN_DECLARATION_PATTERN.exec(markdown);
    if (!match) {
      return blocks;
    }

    const declarationName = match[1];
    const declarationType = getDeclarationType(declarationName);
    const blockId = match[2];
    const attributes = parseDeclarationAttributes(match[3] ?? "", declarationName, declarationType, filePath, blockId);
    const rawContentStart = OPEN_DECLARATION_PATTERN.lastIndex;
    const closeMatch = findClosingDeclaration(markdown, rawContentStart, declarationName, declarationType, filePath, blockId);
    const rawContent = markdown.slice(rawContentStart, closeMatch.index).trim();

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
      type: declarationType,
      exports: attributes.exports ?? [],
      rawContent,
      resolvedDiagramContent: new Map(),
      resolvedFragment: new Map(),
      resolvedMarkdownContent: new Map(),
    });

    OPEN_DECLARATION_PATTERN.lastIndex = closeMatch.index + closeMatch[0].length;
  }
}

function findClosingDeclaration(markdown, startIndex, declarationName, declarationType, filePath, blockId) {
  CLOSE_DECLARATION_PATTERN.lastIndex = startIndex;
  const closeMatch = CLOSE_DECLARATION_PATTERN.exec(markdown);

  if (!closeMatch) {
    throw new MermaidIncludeError(
      `Unclosed ${declarationName} declaration for ${blockId} in ${path.relative(process.cwd(), filePath)}`,
      {
        code: "UNCLOSED_BLOCK_DECLARATION",
        blockId,
        declarationKind: declarationType,
      },
    );
  }

  const closingName = closeMatch[1];
  const closingType = getDeclarationType(closingName);
  if (closingType !== declarationType) {
    throw new MermaidIncludeError(
      `Mismatched closing tag for ${blockId} in ${path.relative(process.cwd(), filePath)}. Expected a closing tag for ${declarationName} but found <!-- /${closingName} -->`,
      {
        code: "MISMATCHED_BLOCK_DECLARATION",
        blockId,
        declarationKind: declarationType,
        closingKind: closingType,
      },
    );
  }

  return closeMatch;
}

function parseDeclarationAttributes(rawAttributes, declarationName, declarationType, filePath, blockId) {
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
      throwTypeAttributeError(value, declarationName, declarationType, filePath, blockId);
    }

    if (key === "exports") {
      if (declarationType !== "fragment") {
        throw new MermaidIncludeError(
          `${formatBlockTypeLabel(declarationType)} ${blockId} in ${path.relative(process.cwd(), filePath)} cannot declare exports. Use mermaid:fragment for reusable Mermaid fragments`,
          {
            code: "INVALID_BLOCK_ATTRIBUTE",
            blockId,
            attribute: key,
          },
        );
      }

      attributes.exports = value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }

  return attributes;
}

function throwTypeAttributeError(value, declarationName, declarationType, filePath, blockId) {
  if (declarationType === "diagram" && value === "fragment") {
    throw new MermaidIncludeError(
      `Legacy fragment declaration for ${blockId} in ${path.relative(process.cwd(), filePath)}. Use <!-- mermaid:fragment ${blockId} ... --> and <!-- /mermaid:fragment --> instead of ${declarationName} ... type=fragment`,
      {
        code: "LEGACY_FRAGMENT_DECLARATION",
        blockId,
      },
    );
  }

  throw new MermaidIncludeError(
    `Declaration ${blockId} in ${path.relative(process.cwd(), filePath)} should not use type=${value}. ${declarationName} already defines the block kind`,
    {
      code: "INVALID_BLOCK_ATTRIBUTE",
      blockId,
      attribute: "type",
      value,
    },
  );
}

function getDeclarationType(declarationName) {
  return DECLARATION_TYPES[declarationName];
}

function formatBlockTypeLabel(blockType) {
  if (blockType === "diagram") {
    return "Diagram block";
  }

  if (blockType === "markdown") {
    return "Markdown block";
  }

  return "Fragment block";
}
