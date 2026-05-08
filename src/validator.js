import path from "node:path";
import process from "node:process";
import DOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import mermaid from "mermaid";

import { MermaidIncludeError } from "./errors.js";

const MERMAID_FENCE_PATTERN = /```mermaid(?!-)[^\n]*\r?\n([\s\S]*?)\r?\n```/g;

let isInitialized = false;

export async function validateMarkdownMermaid(markdown, options = {}) {
  initializeMermaid();

  let blockIndex = 0;

  for (const match of markdown.matchAll(MERMAID_FENCE_PATTERN)) {
    blockIndex += 1;

    try {
      await mermaid.parse(`${match[1].trim()}\n`);
    } catch (error) {
      const target = options.filePath ? path.relative(process.cwd(), options.filePath) : "<markdown>";
      throw new MermaidIncludeError(
        `Mermaid validation failed in ${target} (diagram ${blockIndex}): ${error.message}`,
        {
          code: "INVALID_MERMAID",
          filePath: options.filePath,
          blockIndex,
        },
      );
    }
  }

  return { diagramCount: blockIndex };
}

function initializeMermaid() {
  if (isInitialized) {
    return;
  }

  const domWindow = new JSDOM("").window;
  Object.assign(DOMPurify, DOMPurify(domWindow));
  globalThis.window = domWindow;
  globalThis.document = domWindow.document;

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
  });
  isInitialized = true;
}
