#!/usr/bin/env node
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { MermaidIncludeError, preprocessFile } from "./preprocess.js";

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command !== "build" && command !== "check") {
    throw new MermaidIncludeError(`Unknown command: ${command}`, {
      code: "UNKNOWN_COMMAND",
    });
  }

  const parsed = parseArgs(argv.slice(1));
  if (!parsed.inputPath) {
    throw new MermaidIncludeError("Input Markdown file is required", {
      code: "MISSING_INPUT",
    });
  }

  const inputPath = path.resolve(parsed.inputPath);
  const inputStats = await statInputPath(inputPath);

  if (inputStats.isDirectory()) {
    await handleDirectoryCommand(command, inputPath, parsed);
    return;
  }

  const output = await preprocessFile(inputPath, command === "build" ? parsed.outputPath : undefined, {
    maxIncludeDepth: parsed.maxIncludeDepth,
  });

  if (command === "check") {
    process.stdout.write(`OK ${path.relative(process.cwd(), inputPath)}\n`);
    return;
  }

  if (!parsed.outputPath) {
    process.stdout.write(output);
    if (!output.endsWith("\n")) {
      process.stdout.write("\n");
    }
    return;
  }

  process.stdout.write(`Built ${path.relative(process.cwd(), path.resolve(parsed.outputPath))}\n`);
}

async function handleDirectoryCommand(command, inputPath, parsed) {
  const markdownFiles = await listMarkdownFiles(inputPath);

  if (command === "build" && !parsed.outputPath) {
    throw new MermaidIncludeError("Directory build requires --output <output-dir>", {
      code: "MISSING_OUTPUT",
    });
  }

  for (const filePath of markdownFiles) {
    const relativePath = path.relative(inputPath, filePath);

    if (command === "check") {
      await preprocessFile(filePath, undefined, { maxIncludeDepth: parsed.maxIncludeDepth });
      process.stdout.write(`OK ${path.relative(process.cwd(), filePath)}\n`);
      continue;
    }

    const outputPath = path.join(path.resolve(parsed.outputPath), relativePath);
    await preprocessFile(filePath, outputPath, { maxIncludeDepth: parsed.maxIncludeDepth });
    process.stdout.write(`Built ${path.relative(process.cwd(), outputPath)}\n`);
  }

  const action = command === "check" ? "Checked" : "Built";
  process.stdout.write(`${action} ${markdownFiles.length} Markdown file(s) under ${path.relative(process.cwd(), inputPath)}\n`);
}

function parseArgs(argv) {
  const parsed = {
    inputPath: null,
    outputPath: null,
    maxIncludeDepth: 5,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--output") {
      parsed.outputPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--max-include-depth") {
      const rawDepth = argv[index + 1];
      parsed.maxIncludeDepth = Number.parseInt(rawDepth, 10);
      index += 1;
      continue;
    }

    if (!parsed.inputPath) {
      parsed.inputPath = value;
      continue;
    }

    throw new MermaidIncludeError(`Unexpected argument: ${value}`, {
      code: "UNEXPECTED_ARGUMENT",
    });
  }

  if (!Number.isInteger(parsed.maxIncludeDepth) || parsed.maxIncludeDepth < 1) {
    throw new MermaidIncludeError("--max-include-depth must be a positive integer", {
      code: "INVALID_MAX_DEPTH",
    });
  }

  return parsed;
}

async function listMarkdownFiles(rootDir) {
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

async function statInputPath(inputPath) {
  try {
    return await stat(inputPath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new MermaidIncludeError(`Input path not found: ${path.relative(process.cwd(), inputPath)}`, {
        code: "MISSING_INPUT",
      });
    }

    throw error;
  }
}

function printHelp() {
  process.stdout.write(
    [
      "Usage:",
      "  node ./src/cli.js build <input.md> [--output <output.md>] [--max-include-depth <n>]",
      "  node ./src/cli.js build <input-dir> --output <output-dir> [--max-include-depth <n>]",
      "  node ./src/cli.js check <input.md> [--max-include-depth <n>]",
      "  node ./src/cli.js check <input-dir> [--max-include-depth <n>]",
      "",
      "Commands:",
      "  build  Resolve include directives and write Markdown output",
      "  check  Resolve include directives without writing a file",
    ].join("\n") + "\n",
  );
}

main().catch((error) => {
  if (error instanceof MermaidIncludeError) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  throw error;
});
