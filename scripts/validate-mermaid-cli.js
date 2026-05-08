#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MERMAID_FENCE_PATTERN = /```mermaid[^\n]*\r?\n([\s\S]*?)\r?\n```/g;

async function main() {
  const files = process.argv.slice(2);

  if (files.length === 0) {
    process.stderr.write("Usage: node ./scripts/validate-mermaid-cli.js <file.md> [more.md]\n");
    process.exitCode = 1;
    return;
  }

  const workspace = await mkdtemp(path.join(tmpdir(), "mermaid-validate-"));

  try {
    let diagramCount = 0;

    for (const file of files) {
      const absolutePath = path.resolve(file);
      const markdown = await readFile(absolutePath, "utf8");
      let blockIndex = 0;

      for (const match of markdown.matchAll(MERMAID_FENCE_PATTERN)) {
        blockIndex += 1;
        diagramCount += 1;

        const inputPath = path.join(workspace, `diagram-${diagramCount}.mmd`);
        const outputPath = path.join(workspace, `diagram-${diagramCount}.svg`);
        await writeFile(inputPath, `${match[1].trim()}\n`, "utf8");

        await execFileAsync(
          "npx",
          ["--yes", "@mermaid-js/mermaid-cli", "-i", inputPath, "-o", outputPath],
          { cwd: workspace, timeout: 240000 },
        );
      }

      process.stdout.write(`Validated ${blockIndex} Mermaid block(s) in ${path.relative(process.cwd(), absolutePath)}\n`);
    }

    process.stdout.write(`Validation complete: ${diagramCount} Mermaid block(s) checked\n`);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`Validation failed: ${error.message}\n`);
  process.exitCode = 1;
});
