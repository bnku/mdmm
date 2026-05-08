import path from "node:path";
import process from "node:process";

import { MermaidIncludeError } from "./errors.js";

const BLOCK_ID_PATTERN = "[A-Za-z0-9._-]+";
const OPEN_DECLARATION_PATTERN = new RegExp(
  `<!--\\s*mermaid:(block|fragment)\\s+(${BLOCK_ID_PATTERN})([^>]*)-->`,
  "g",
);
const CLOSE_DECLARATION_PATTERN = /<!--\s*\/mermaid:(block|fragment)\s*-->/g;

export function extractBlocks(markdown, filePath) {
  const blocks = new Map();
  OPEN_DECLARATION_PATTERN.lastIndex = 0;

  while (true) {
    const match = OPEN_DECLARATION_PATTERN.exec(markdown);
    if (!match) {
      return blocks;
    }

    const declarationKind = match[1];
    const blockId = match[2];
    const attributes = parseDeclarationAttributes(match[3] ?? "", declarationKind, filePath, blockId);
    const rawContentStart = OPEN_DECLARATION_PATTERN.lastIndex;
    const closeMatch = findClosingDeclaration(markdown, rawContentStart, declarationKind, filePath, blockId);
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
      type: declarationKind === "fragment" ? "fragment" : "diagram",
      exports: attributes.exports ?? [],
      rawContent,
      resolvedDiagramContent: new Map(),
      resolvedFragment: new Map(),
    });

    OPEN_DECLARATION_PATTERN.lastIndex = closeMatch.index + closeMatch[0].length;
  }
}

function findClosingDeclaration(markdown, startIndex, declarationKind, filePath, blockId) {
  CLOSE_DECLARATION_PATTERN.lastIndex = startIndex;
  const closeMatch = CLOSE_DECLARATION_PATTERN.exec(markdown);

  if (!closeMatch) {
    throw new MermaidIncludeError(
      `Unclosed mermaid:${declarationKind} declaration for ${blockId} in ${path.relative(process.cwd(), filePath)}`,
      {
        code: "UNCLOSED_BLOCK_DECLARATION",
        blockId,
        declarationKind,
      },
    );
  }

  const closingKind = closeMatch[1];
  if (closingKind !== declarationKind) {
    throw new MermaidIncludeError(
      `Mismatched closing tag for ${blockId} in ${path.relative(process.cwd(), filePath)}. Expected <!-- /mermaid:${declarationKind} --> but found <!-- /mermaid:${closingKind} -->`,
      {
        code: "MISMATCHED_BLOCK_DECLARATION",
        blockId,
        declarationKind,
        closingKind,
      },
    );
  }

  return closeMatch;
}

function parseDeclarationAttributes(rawAttributes, declarationKind, filePath, blockId) {
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
      throwTypeAttributeError(value, declarationKind, filePath, blockId);
    }

    if (key === "exports") {
      if (declarationKind !== "fragment") {
        throw new MermaidIncludeError(
          `Diagram block ${blockId} in ${path.relative(process.cwd(), filePath)} cannot declare exports. Use mermaid:fragment for reusable fragments`,
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

function throwTypeAttributeError(value, declarationKind, filePath, blockId) {
  if (declarationKind === "block" && value === "fragment") {
    throw new MermaidIncludeError(
      `Legacy fragment declaration for ${blockId} in ${path.relative(process.cwd(), filePath)}. Use <!-- mermaid:fragment ${blockId} ... --> and <!-- /mermaid:fragment --> instead of mermaid:block ... type=fragment`,
      {
        code: "LEGACY_FRAGMENT_DECLARATION",
        blockId,
      },
    );
  }

  throw new MermaidIncludeError(
    `Declaration ${blockId} in ${path.relative(process.cwd(), filePath)} should not use type=${value}. mermaid:${declarationKind} already defines the block kind`,
    {
      code: "INVALID_BLOCK_ATTRIBUTE",
      blockId,
      attribute: "type",
      value,
    },
  );
}
