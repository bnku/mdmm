#!/usr/bin/env node
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { MermaidIncludeError } from "./errors.js";
import { preprocessFile } from "./preprocess.js";
import { CONFIG_FILE_NAME, isSameOrNestedPath, loadProjectSettings } from "./project.js";
import { buildDependencyReport } from "./report.js";

export async function main(argv = process.argv.slice(2)) {
  const command = argv[0];

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command !== "build" && command !== "check" && command !== "report") {
    throw new MermaidIncludeError(`Unknown command: ${command}`, {
      code: "UNKNOWN_COMMAND",
    });
  }

  const parsed = parseArgs(argv.slice(1));
  const projectSettings = await loadProjectSettings(parsed.inputPath ?? process.cwd(), { cwd: process.cwd() });
  const inputPath = path.resolve(parsed.inputPath ?? projectSettings.docsDir);
  const inputStats = await statInputPath(inputPath);

  if (command === "report") {
    await handleReportCommand(inputPath, inputStats, parsed, projectSettings);
    return;
  }

  if (inputStats.isDirectory()) {
    await handleDirectoryCommand(command, inputPath, parsed, projectSettings);
    return;
  }

  const output = await preprocessFile(inputPath, command === "build" ? parsed.outputPath : undefined, {
    maxIncludeDepth: parsed.maxIncludeDepth,
    projectSettings,
    cwd: process.cwd(),
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

async function handleReportCommand(inputPath, inputStats, parsed, projectSettings) {
  const filePaths = inputStats.isDirectory()
    ? await listMarkdownFiles(inputPath, { ignoredDirs: getIgnoredDirs(inputPath, projectSettings) })
    : [inputPath];

  const report = await buildDependencyReport(filePaths, {
    cwd: process.cwd(),
    rootPath: inputPath,
    projectSettings,
  });

  const output = `${JSON.stringify(report, null, 2)}\n`;

  if (parsed.outputPath) {
    const outputPath = path.resolve(parsed.outputPath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, output, "utf8");
    process.stdout.write(`Wrote ${path.relative(process.cwd(), outputPath)}\n`);
    return;
  }

  process.stdout.write(output);
}

async function handleDirectoryCommand(command, inputPath, parsed, projectSettings) {
  const markdownFiles = await listMarkdownFiles(inputPath, { ignoredDirs: getIgnoredDirs(inputPath, projectSettings) });
  const outputBaseDir = path.resolve(parsed.outputPath ?? projectSettings.outputDir);

  for (const filePath of markdownFiles) {
    const relativePath = path.relative(inputPath, filePath);

    if (command === "check") {
      await preprocessFile(filePath, undefined, {
        maxIncludeDepth: parsed.maxIncludeDepth,
        projectSettings,
        cwd: process.cwd(),
      });
      process.stdout.write(`OK ${path.relative(process.cwd(), filePath)}\n`);
      continue;
    }

    const outputPath = path.join(outputBaseDir, relativePath);
    await preprocessFile(filePath, outputPath, {
      maxIncludeDepth: parsed.maxIncludeDepth,
      projectSettings,
      cwd: process.cwd(),
    });
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

async function listMarkdownFiles(rootDir, options = {}) {
  const ignoredDirs = options.ignoredDirs ?? [];
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      if (ignoredDirs.some((ignoredDir) => isSameOrNestedPath(ignoredDir, entryPath))) {
        continue;
      }

      files.push(...(await listMarkdownFiles(entryPath, options)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(entryPath);
    }
  }

  return files;
}

function getIgnoredDirs(inputPath, projectSettings) {
  return [projectSettings.sharedDir, projectSettings.outputDir].filter(
    (dirPath) => dirPath !== inputPath && isSameOrNestedPath(inputPath, dirPath),
  );
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
  const cliName = "mermaid-include-sync";

  process.stdout.write(
    [
      "Usage:",
      `  ${cliName} build [<input.md|input-dir>] [--output <output-path>] [--max-include-depth <n>]`,
      `  ${cliName} check [<input.md|input-dir>] [--max-include-depth <n>]`,
      `  ${cliName} report [<input.md|input-dir>] [--output <report.json>]`,
      "",
      `Config file: ${CONFIG_FILE_NAME}`,
      "  optional fields: docsDir, sharedDir, outputDir",
      "  omitted config falls back to cwd/docs, cwd/shared, cwd/dist",
      "  config is auto-discovered from the input path upward",
      "",
      "Commands:",
      "  build  Resolve include directives and write Markdown output",
      "  check  Resolve include directives without writing a file",
      "  report Build a JSON dependency report for include usage",
    ].join("\n") + "\n",
  );
}

export async function runCli(argv = process.argv.slice(2)) {
  try {
    await main(argv);
  } catch (error) {
    handleCliError(error);
  }
}

function handleCliError(error) {
  if (error instanceof MermaidIncludeError) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  throw error;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
