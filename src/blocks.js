import path from "node:path";
import process from "node:process";

import { MermaidIncludeError } from "./errors.js";

const BLOCK_PATTERN = /<!--\s*mermaid:block\s+([A-Za-z0-9._-]+)([^>]*)-->\s*([\s\S]*?)\s*<!--\s*\/mermaid:block\s*-->/g;

export function extractBlocks(markdown, filePath) {
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
