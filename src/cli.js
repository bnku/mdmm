#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import packageJson from "../package.json" with { type: "json" };
import { pathToFileURL } from "node:url";

import { startDevSession } from "./dev.js";
import { MermaidIncludeError } from "./errors.js";
import { getIgnoredDirs, listMarkdownFiles, statInputPath, writeTextFile } from "./files.js";
import { createLogger } from "./logger.js";
import { loadProjectSettings } from "./project.js";
import { preprocessFile } from "./preprocess.js";
import { buildDependencyReport } from "./report.js";
import { initializeProject } from "./scaffold.js";
import { validateMarkdownMermaid } from "./validator.js";

const COMMANDS = {
  build: {
    summary: "Resolve includes, validate Mermaid, and write Markdown output",
    usage: "mdmm build [<input.md|input-dir>] [--output <output-path>] [--max-include-depth <n>] [--no-validate]",
    handler: handleBuildCommand,
  },
  dev: {
    summary: "Watch docs and selectively rebuild affected Markdown output",
    usage: "mdmm dev [<input-dir>] [--output <output-path>] [--max-include-depth <n>] [--no-validate]",
    handler: handleDevCommand,
  },
  check: {
    summary: "Resolve include directives without writing files",
    usage: "mdmm check [<input.md|input-dir>] [--max-include-depth <n>]",
    handler: handleCheckCommand,
  },
  report: {
    summary: "Build a JSON dependency report for include usage",
    usage: "mdmm report [<input.md|input-dir>] [--output <report.json>]",
    handler: handleReportCommandEntry,
  },
  init: {
    summary: "Interactively scaffold a new mdmm docs project",
    usage: "mdmm init [--yes] [--force] [--no-starter]",
    handler: handleInitCommand,
  },
  adopt: {
    summary: "Planned retrofit flow for an existing docs project",
    usage: "mdmm adopt",
    handler: handleAdoptCommand,
  },
};

export async function main(argv = process.argv.slice(2), options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const rawArgv = [...argv];
  const commandArgv = stripGlobalNoColorFlag(rawArgv);
  const logger = createLogger({
    stdout,
    stderr,
    noColor: rawArgv.includes("--no-color"),
  });

  if (commandArgv.length === 0 || isHelpFlag(commandArgv[0])) {
    printGeneralHelp(logger);
    return;
  }

  if (commandArgv.length === 1 && isVersionFlag(commandArgv[0])) {
    logger.write(`${packageJson.version}\n`);
    return;
  }

  const command = commandArgv[0];
  const commandEntry = COMMANDS[command];

  if (!commandEntry) {
    throw new MermaidIncludeError(`Unknown command: ${command}`, {
      code: "UNKNOWN_COMMAND",
    });
  }

  await commandEntry.handler(commandArgv.slice(1), {
    logger,
    cwd: options.cwd ?? process.cwd(),
  });
}

async function handleBuildCommand(argv, context) {
  if (hasCommandHelpFlag(argv)) {
    printCommandHelp(context.logger, "build");
    return;
  }

  const parsed = parsePathCommandArgs(argv, {
    allowOutput: true,
    allowValidateToggle: true,
  });
  const projectSettings = await loadProjectSettings(parsed.inputPath ?? context.cwd, { cwd: context.cwd });
  const inputPath = path.resolve(parsed.inputPath ?? projectSettings.docsDir);
  const inputStats = await statInputPath(inputPath, context.cwd);

  if (inputStats.isDirectory()) {
    await buildDirectory(inputPath, parsed, projectSettings, context);
    return;
  }

  const output = await preprocessFile(inputPath, undefined, {
    maxIncludeDepth: parsed.maxIncludeDepth,
    projectSettings,
    cwd: context.cwd,
  });

  if (parsed.validate) {
    await validateMarkdownMermaid(output, { filePath: inputPath });
  }

  if (!parsed.outputPath) {
    context.logger.write(output);
    if (!output.endsWith("\n")) {
      context.logger.write("\n");
    }
    return;
  }

  const outputPath = path.resolve(parsed.outputPath);
  await writeTextFile(outputPath, output);
  context.logger.success(`Built ${path.relative(context.cwd, outputPath)}`);
}

async function handleCheckCommand(argv, context) {
  if (hasCommandHelpFlag(argv)) {
    printCommandHelp(context.logger, "check");
    return;
  }

  const parsed = parsePathCommandArgs(argv, {
    allowOutput: false,
    allowValidateToggle: false,
  });
  const projectSettings = await loadProjectSettings(parsed.inputPath ?? context.cwd, { cwd: context.cwd });
  const inputPath = path.resolve(parsed.inputPath ?? projectSettings.docsDir);
  const inputStats = await statInputPath(inputPath, context.cwd);

  if (inputStats.isDirectory()) {
    await checkDirectory(inputPath, parsed, projectSettings, context);
    return;
  }

  await preprocessFile(inputPath, undefined, {
    maxIncludeDepth: parsed.maxIncludeDepth,
    projectSettings,
    cwd: context.cwd,
  });
  context.logger.success(`OK ${path.relative(context.cwd, inputPath)}`);
}

async function handleDevCommand(argv, context) {
  if (hasCommandHelpFlag(argv)) {
    printCommandHelp(context.logger, "dev");
    return;
  }

  const parsed = parsePathCommandArgs(argv, {
    allowOutput: true,
    allowValidateToggle: true,
  });
  const session = await startDevSession({
    cwd: context.cwd,
    logger: context.logger,
    inputPath: parsed.inputPath,
    outputPath: parsed.outputPath,
    maxIncludeDepth: parsed.maxIncludeDepth,
    validate: parsed.validate,
  });
  const closeSession = () => session.close();

  process.once("SIGINT", closeSession);
  process.once("SIGTERM", closeSession);

  try {
    await session.done;
  } finally {
    process.off("SIGINT", closeSession);
    process.off("SIGTERM", closeSession);
  }
}

async function handleReportCommandEntry(argv, context) {
  if (hasCommandHelpFlag(argv)) {
    printCommandHelp(context.logger, "report");
    return;
  }

  const parsed = parsePathCommandArgs(argv, {
    allowOutput: true,
    allowValidateToggle: false,
    allowMaxIncludeDepth: false,
  });
  const projectSettings = await loadProjectSettings(parsed.inputPath ?? context.cwd, { cwd: context.cwd });
  const inputPath = path.resolve(parsed.inputPath ?? projectSettings.docsDir);
  const inputStats = await statInputPath(inputPath, context.cwd);
  await handleReportCommand(inputPath, inputStats, parsed, projectSettings, context);
}

async function handleInitCommand(argv, context) {
  if (hasCommandHelpFlag(argv)) {
    printCommandHelp(context.logger, "init");
    return;
  }

  const parsed = parseInitArgs(argv);
  const result = await initializeProject(context.cwd, {
    yes: parsed.yes,
    force: parsed.force,
    createStarter: !parsed.noStarter,
    stdin: process.stdin,
    stdout: process.stdout,
  });

  context.logger.success(`Initialized mdmm project in ${path.relative(context.cwd, result.rootDir) || "."}`);

  for (const createdPath of result.createdPaths) {
    context.logger.success(`Created ${path.relative(context.cwd, createdPath)}`);
  }

  context.logger.info("");
  context.logger.info("Next steps:");
  context.logger.info("  mdmm check");
  context.logger.info("  mdmm build");
  context.logger.info("  mdmm report --output ./dist/dependencies.json");
}

async function handleAdoptCommand(argv, context) {
  if (argv.length > 0 && !hasCommandHelpFlag(argv)) {
    throw new MermaidIncludeError(`Unexpected argument: ${argv[0]}`, {
      code: "UNEXPECTED_ARGUMENT",
    });
  }

  if (hasCommandHelpFlag(argv)) {
    printCommandHelp(context.logger, "adopt");
    return;
  }

  context.logger.info("mdmm adopt is planned but not implemented yet.");
  context.logger.info("Future flow will analyze an existing docs project, find duplicate Mermaid blocks,");
  context.logger.info("suggest candidates for shared blocks, and only later offer explicit write/apply steps.");
  context.logger.info("Today use `mdmm report` and `mdmm check` while that retrofit workflow is still being built.");
}

async function handleReportCommand(inputPath, inputStats, parsed, projectSettings, context) {
  const filePaths = inputStats.isDirectory()
    ? await listMarkdownFiles(inputPath, { ignoredDirs: getIgnoredDirs(inputPath, projectSettings) })
    : [inputPath];

  const report = await buildDependencyReport(filePaths, {
    cwd: context.cwd,
    rootPath: inputPath,
    projectSettings,
  });

  const output = `${JSON.stringify(report, null, 2)}\n`;

  if (!parsed.outputPath) {
    context.logger.write(output);
    return;
  }

  const outputPath = path.resolve(parsed.outputPath);
  await writeTextFile(outputPath, output);
  context.logger.success(`Wrote ${path.relative(context.cwd, outputPath)}`);
}

async function buildDirectory(inputPath, parsed, projectSettings, context) {
  const markdownFiles = await listMarkdownFiles(inputPath, { ignoredDirs: getIgnoredDirs(inputPath, projectSettings) });
  const outputBaseDir = path.resolve(parsed.outputPath ?? projectSettings.outputDir);
  const stagedOutputs = [];

  for (const filePath of markdownFiles) {
    const relativePath = path.relative(inputPath, filePath);
    const output = await preprocessFile(filePath, undefined, {
      maxIncludeDepth: parsed.maxIncludeDepth,
      projectSettings,
      cwd: context.cwd,
    });

    if (parsed.validate) {
      await validateMarkdownMermaid(output, { filePath });
    }

    stagedOutputs.push({
      filePath,
      outputPath: path.join(outputBaseDir, relativePath),
      output,
    });
  }

  for (const entry of stagedOutputs) {
    await writeTextFile(entry.outputPath, entry.output);
    context.logger.success(`Built ${path.relative(context.cwd, entry.outputPath)}`);
  }

  context.logger.success(
    `Built ${stagedOutputs.length} Markdown file(s) under ${path.relative(context.cwd, inputPath)}`,
  );
}

async function checkDirectory(inputPath, parsed, projectSettings, context) {
  const markdownFiles = await listMarkdownFiles(inputPath, { ignoredDirs: getIgnoredDirs(inputPath, projectSettings) });

  for (const filePath of markdownFiles) {
    await preprocessFile(filePath, undefined, {
      maxIncludeDepth: parsed.maxIncludeDepth,
      projectSettings,
      cwd: context.cwd,
    });
    context.logger.success(`OK ${path.relative(context.cwd, filePath)}`);
  }

  context.logger.success(`Checked ${markdownFiles.length} Markdown file(s) under ${path.relative(context.cwd, inputPath)}`);
}

function parsePathCommandArgs(argv, options = {}) {
  const allowOutput = options.allowOutput ?? false;
  const allowValidateToggle = options.allowValidateToggle ?? false;
  const allowMaxIncludeDepth = options.allowMaxIncludeDepth ?? true;
  const parsed = {
    inputPath: null,
    outputPath: null,
    maxIncludeDepth: 5,
    validate: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--output") {
      if (!allowOutput) {
        throw new MermaidIncludeError(`Unexpected argument: ${value}`, {
          code: "UNEXPECTED_ARGUMENT",
        });
      }

      const outputPath = argv[index + 1];
      if (!outputPath || outputPath.startsWith("--")) {
        throw new MermaidIncludeError("--output requires a value", {
          code: "MISSING_OPTION_VALUE",
        });
      }

      parsed.outputPath = outputPath;
      index += 1;
      continue;
    }

    if (value === "--max-include-depth") {
      if (!allowMaxIncludeDepth) {
        throw new MermaidIncludeError(`Unexpected argument: ${value}`, {
          code: "UNEXPECTED_ARGUMENT",
        });
      }

      const rawDepth = argv[index + 1];
      if (!rawDepth || rawDepth.startsWith("--")) {
        throw new MermaidIncludeError("--max-include-depth requires a value", {
          code: "MISSING_OPTION_VALUE",
        });
      }

      parsed.maxIncludeDepth = Number.parseInt(rawDepth, 10);
      index += 1;
      continue;
    }

    if (value === "--no-validate") {
      if (!allowValidateToggle) {
        throw new MermaidIncludeError(`Unexpected argument: ${value}`, {
          code: "UNEXPECTED_ARGUMENT",
        });
      }

      parsed.validate = false;
      continue;
    }

    if (value.startsWith("--")) {
      throw new MermaidIncludeError(`Unexpected argument: ${value}`, {
        code: "UNEXPECTED_ARGUMENT",
      });
    }

    if (!parsed.inputPath) {
      parsed.inputPath = value;
      continue;
    }

    throw new MermaidIncludeError(`Unexpected argument: ${value}`, {
      code: "UNEXPECTED_ARGUMENT",
    });
  }

  if (allowMaxIncludeDepth && (!Number.isInteger(parsed.maxIncludeDepth) || parsed.maxIncludeDepth < 1)) {
    throw new MermaidIncludeError("--max-include-depth must be a positive integer", {
      code: "INVALID_MAX_DEPTH",
    });
  }

  return parsed;
}

function parseInitArgs(argv) {
  const parsed = {
    yes: false,
    force: false,
    noStarter: false,
  };

  for (const value of argv) {
    if (value === "--yes") {
      parsed.yes = true;
      continue;
    }

    if (value === "--force") {
      parsed.force = true;
      continue;
    }

    if (value === "--no-starter") {
      parsed.noStarter = true;
      continue;
    }

    throw new MermaidIncludeError(`Unexpected argument: ${value}`, {
      code: "UNEXPECTED_ARGUMENT",
    });
  }

  return parsed;
}

function printGeneralHelp(logger) {
  logger.write(
    [
      "Usage:",
      "  mdmm <command> [options]",
      "",
      "Commands:",
      ...Object.values(COMMANDS).map((entry) => `  ${entry.usage.padEnd(78)} ${entry.summary}`),
      "",
      "Global options:",
      "  --help        Show this help",
      "  --version     Print installed mdmm version",
      "  --no-color    Disable ANSI colors in CLI output",
      "",
      "Quick start:",
      "  npm i -g @bnku/mdmm && mdmm init",
      "  npx @bnku/mdmm@latest init",
      "  npx @bnku/mdmm@latest check",
      "",
      "Command model:",
      "  init   scaffold a new docs project",
      "  check  fast structural mdmm validation",
      "  dev    watch docs and selectively rebuild affected output",
      "  build  publish-oriented build with Mermaid validation by default",
      "  adopt  planned future flow for retrofitting an existing docs project",
    ].join("\n") + "\n",
  );
}

function printCommandHelp(logger, command) {
  if (command === "build") {
    logger.write(
      [
        "Usage:",
        `  ${COMMANDS.build.usage}`,
        "",
        "What it does:",
        "  Resolves mdmm includes, validates final Mermaid output by default, and writes Markdown.",
        "",
        "Examples:",
        "  mdmm build",
        "  mdmm build ./docs --output ./dist/docs",
        "  mdmm build ./docs --no-validate",
      ].join("\n") + "\n",
    );
    return;
  }

  if (command === "dev") {
    logger.write(
      [
        "Usage:",
        `  ${COMMANDS.dev.usage}`,
        "",
        "What it does:",
        "  Watches docs and shared Mermaid files, then selectively rebuilds only affected Markdown output.",
        "",
        "Examples:",
        "  mdmm dev",
        "  mdmm dev ./docs --output ./dist/docs",
        "  mdmm dev ./docs --no-validate",
      ].join("\n") + "\n",
    );
    return;
  }

  if (command === "check") {
    logger.write(
      [
        "Usage:",
        `  ${COMMANDS.check.usage}`,
        "",
        "What it does:",
        "  Resolves includes and mdmm-specific rules without writing files or running final Mermaid validation.",
        "",
        "Examples:",
        "  mdmm check",
        "  mdmm check ./docs",
      ].join("\n") + "\n",
    );
    return;
  }

  if (command === "report") {
    logger.write(
      [
        "Usage:",
        `  ${COMMANDS.report.usage}`,
        "",
        "What it does:",
        "  Builds a JSON usage map for Markdown, diagram, and fragment dependencies.",
        "",
        "Examples:",
        "  mdmm report",
        "  mdmm report ./docs --output ./dist/dependencies.json",
      ].join("\n") + "\n",
    );
    return;
  }

  if (command === "init") {
    logger.write(
      [
        "Usage:",
        `  ${COMMANDS.init.usage}`,
        "",
        "What it does:",
        "  Creates mdmm.config.json, docs/shared/dist directories, and optional starter files.",
        "",
        "Examples:",
        "  mdmm init",
        "  mdmm init --yes",
        "  mdmm init --yes --no-starter",
        "  mdmm init --force",
      ].join("\n") + "\n",
    );
    return;
  }

  logger.write(
    [
      "Usage:",
      `  ${COMMANDS.adopt.usage}`,
      "",
      "What it does:",
      "  Reserved for a future analyze-first workflow that will help retrofit mdmm into an existing docs project.",
    ].join("\n") + "\n",
  );
}

function stripGlobalNoColorFlag(argv) {
  return argv.filter((value) => value !== "--no-color");
}

function hasCommandHelpFlag(argv) {
  return argv.length === 1 && isHelpFlag(argv[0]);
}

function isHelpFlag(value) {
  return value === "--help" || value === "-h";
}

function isVersionFlag(value) {
  return value === "--version" || value === "-v";
}

export async function runCli(argv = process.argv.slice(2), options = {}) {
  try {
    await main(argv, options);
  } catch (error) {
    handleCliError(error, options);
  }
}

function handleCliError(error, options = {}) {
  if (error instanceof MermaidIncludeError) {
    const logger = createLogger({
      stdout: options.stdout ?? process.stdout,
      stderr: options.stderr ?? process.stderr,
      noColor: (options.argv ?? process.argv.slice(2)).includes("--no-color"),
    });
    logger.error(`Error: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  throw error;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2), { argv: process.argv.slice(2) });
}
