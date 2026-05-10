#!/usr/bin/env node
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MERMAID_FENCE_PATTERN = /```mermaid[^\n]*\r?\n([\s\S]*?)\r?\n```/g;

async function main() {
  const inputPaths = process.argv.slice(2);

  if (inputPaths.length === 0) {
    process.stderr.write("Usage: node ./scripts/validate-mermaid-cli.js <file.md|dir> [more.md|dir]\n");
    process.exitCode = 1;
    return;
  }

  const files = await collectMarkdownFiles(inputPaths);

  if (files.length === 0) {
    process.stderr.write("Validation failed: no Markdown files found\n");
    process.exitCode = 1;
    return;
  }

  const workspace = await mkdtemp(path.join(tmpdir(), "mermaid-validate-"));

  try {
    const puppeteerConfigPath = process.env.CI ? await writeCiPuppeteerConfig(workspace) : null;
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

        const commandArgs = ["--yes", "@mermaid-js/mermaid-cli", "-i", inputPath, "-o", outputPath];

        if (puppeteerConfigPath) {
          commandArgs.push("-p", puppeteerConfigPath);
        }

        await execFileAsync("npx", commandArgs, { cwd: workspace, timeout: 240000 });
      }

      process.stdout.write(`Validated ${blockIndex} Mermaid block(s) in ${path.relative(process.cwd(), absolutePath)}\n`);
    }

    process.stdout.write(`Validation complete: ${diagramCount} Mermaid block(s) checked\n`);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function collectMarkdownFiles(inputPaths) {
  const files = [];

  for (const inputPath of inputPaths) {
    const absolutePath = path.resolve(inputPath);
    const inputStat = await stat(absolutePath);

    if (inputStat.isDirectory()) {
      files.push(...await listMarkdownFiles(absolutePath));
      continue;
    }

    files.push(absolutePath);
  }

  return files.sort();
}

async function listMarkdownFiles(directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...await listMarkdownFiles(entryPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(entryPath);
    }
  }

  return files;
}

async function writeCiPuppeteerConfig(workspace) {
  const configPath = path.join(workspace, "puppeteer-config.json");
  const config = {
    args: ["--no-sandbox"],
  };

  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  return configPath;
}

main().catch((error) => {
  process.stderr.write(`Validation failed: ${error.message}\n`);
  process.exitCode = 1;
});
