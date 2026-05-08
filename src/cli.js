#!/usr/bin/env node
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { MermaidIncludeError, preprocessFile } from "./preprocess.js";
import { buildDependencyReport } from "./report.js";

const CONFIG_FILE_NAME = "mermaid-include.config.json";
const DEFAULT_INCLUDE_PATTERNS = ["**/*.md"];

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
  if (!parsed.inputPath) {
    throw new MermaidIncludeError("Input Markdown file is required", {
      code: "MISSING_INPUT",
    });
  }

  const inputPath = path.resolve(parsed.inputPath);
  const inputStats = await statInputPath(inputPath);

  if (command === "report") {
    await handleReportCommand(inputPath, inputStats, parsed);
    return;
  }

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

async function handleReportCommand(inputPath, inputStats, parsed) {
  const filePaths = inputStats.isDirectory()
    ? filterMarkdownFiles(await listMarkdownFiles(inputPath), inputPath, await loadDirectoryConfig(inputPath))
    : [inputPath];

  const report = await buildDependencyReport(filePaths, {
    cwd: process.cwd(),
    rootPath: inputPath,
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

async function handleDirectoryCommand(command, inputPath, parsed) {
  const config = await loadDirectoryConfig(inputPath);
  const markdownFiles = filterMarkdownFiles(await listMarkdownFiles(inputPath), inputPath, config);

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

function filterMarkdownFiles(files, inputPath, config) {
  const includePatterns = config?.include ?? DEFAULT_INCLUDE_PATTERNS;
  const excludePatterns = config?.exclude ?? [];
  const configBaseDir = config?.baseDir ?? inputPath;

  return files.filter((filePath) => {
    const relativePath = normalizeGlobPath(path.relative(configBaseDir, filePath));
    const isIncluded = includePatterns.some((pattern) => path.matchesGlob(relativePath, pattern));
    const isExcluded = excludePatterns.some((pattern) => path.matchesGlob(relativePath, pattern));
    return isIncluded && !isExcluded;
  });
}

async function loadDirectoryConfig(inputPath) {
  const configPath = await findConfigPath(inputPath);
  if (!configPath) {
    return null;
  }

  let parsedConfig;

  try {
    parsedConfig = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    throw new MermaidIncludeError(`Invalid JSON in ${path.relative(process.cwd(), configPath)}`, {
      code: "INVALID_CONFIG",
      configPath,
    });
  }

  if (!parsedConfig || typeof parsedConfig !== "object" || Array.isArray(parsedConfig)) {
    throw new MermaidIncludeError(`Config ${path.relative(process.cwd(), configPath)} must be a JSON object`, {
      code: "INVALID_CONFIG",
      configPath,
    });
  }

  const include = normalizePatternList(parsedConfig.include, "include", configPath);
  const exclude = normalizePatternList(parsedConfig.exclude, "exclude", configPath);

  return {
    baseDir: path.dirname(configPath),
    configPath,
    include,
    exclude,
  };
}

async function findConfigPath(startDir) {
  let currentDir = startDir;

  while (true) {
    const candidatePath = path.join(currentDir, CONFIG_FILE_NAME);

    try {
      const candidateStats = await stat(candidatePath);
      if (candidateStats.isFile()) {
        return candidatePath;
      }
    } catch (error) {
      if (!error || error.code !== "ENOENT") {
        throw error;
      }
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

function normalizePatternList(value, key, configPath) {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new MermaidIncludeError(
      `Config field ${key} in ${path.relative(process.cwd(), configPath)} must be an array of non-empty strings`,
      {
        code: "INVALID_CONFIG",
        configPath,
        key,
      },
    );
  }

  return value.map(normalizeGlobPath);
}

function normalizeGlobPath(value) {
  return value.split(path.sep).join("/");
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
      `  ${cliName} build <input.md> [--output <output.md>] [--max-include-depth <n>]`,
      `  ${cliName} build <input-dir> --output <output-dir> [--max-include-depth <n>]`,
      `  ${cliName} check <input.md> [--max-include-depth <n>]`,
      `  ${cliName} check <input-dir> [--max-include-depth <n>]`,
      `  ${cliName} report <input.md|input-dir> [--output <report.json>]`,
      "",
      `Config file: ${CONFIG_FILE_NAME}`,
      "  include/exclude patterns are applied in directory mode",
      "  config is auto-discovered from the input directory upward",
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
