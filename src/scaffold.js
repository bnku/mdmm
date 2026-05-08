import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";

import { MermaidIncludeError } from "./errors.js";
import { CONFIG_FILE_NAME } from "./project.js";

const DEFAULT_LAYOUT = {
  docsDir: "docs",
  sharedDir: "shared",
  outputDir: "dist",
};

export async function initializeProject(rootDir, options = {}) {
  const settings = options.yes
    ? {
        ...DEFAULT_LAYOUT,
        createStarter: options.createStarter ?? true,
      }
    : await promptForProjectLayout({
        stdin: options.stdin,
        stdout: options.stdout,
        defaultCreateStarter: options.createStarter ?? true,
      });

  const absoluteRootDir = path.resolve(rootDir);
  const plannedFiles = buildPlannedFiles(absoluteRootDir, settings);

  for (const plannedFile of plannedFiles) {
    await assertWritableFile(plannedFile.path, options.force ?? false);
  }

  await mkdir(path.join(absoluteRootDir, settings.docsDir), { recursive: true });
  await mkdir(path.join(absoluteRootDir, settings.sharedDir), { recursive: true });
  await mkdir(path.join(absoluteRootDir, settings.outputDir), { recursive: true });

  for (const plannedFile of plannedFiles) {
    await writeFile(plannedFile.path, plannedFile.content, "utf8");
  }

  return {
    rootDir: absoluteRootDir,
    createdPaths: plannedFiles.map((plannedFile) => plannedFile.path),
  };
}

async function promptForProjectLayout(options = {}) {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;

  if (!stdin.isTTY || !stdout.isTTY) {
    throw new MermaidIncludeError("mdmm init needs an interactive terminal or --yes to accept defaults", {
      code: "NON_INTERACTIVE_INIT",
    });
  }

  const readline = createInterface({
    input: stdin,
    output: stdout,
  });

  try {
    const docsDir = await promptWithDefault(readline, "Docs directory", DEFAULT_LAYOUT.docsDir);
    const sharedDir = await promptWithDefault(readline, "Shared diagram directory", DEFAULT_LAYOUT.sharedDir);
    const outputDir = await promptWithDefault(readline, "Build output directory", DEFAULT_LAYOUT.outputDir);
    const starterAnswer = await promptWithDefault(
      readline,
      "Create starter files? [Y/n]",
      options.defaultCreateStarter === false ? "n" : "y",
    );

    return {
      docsDir,
      sharedDir,
      outputDir,
      createStarter: !isNegativeAnswer(starterAnswer),
    };
  } finally {
    readline.close();
  }
}

async function promptWithDefault(readline, label, fallback) {
  const answer = (await readline.question(`${label} (${fallback}): `)).trim();
  return answer || fallback;
}

function buildPlannedFiles(rootDir, settings) {
  const docsDir = path.join(rootDir, settings.docsDir);
  const sharedDir = path.join(rootDir, settings.sharedDir);
  const plannedFiles = [
    {
      path: path.join(rootDir, CONFIG_FILE_NAME),
      content: `${JSON.stringify(
        {
          docsDir: settings.docsDir,
          sharedDir: settings.sharedDir,
          outputDir: settings.outputDir,
        },
        null,
        2,
      )}\n`,
    },
  ];

  if (settings.createStarter) {
    plannedFiles.push(
      {
        path: path.join(sharedDir, "getting-started.md"),
        content: "<!-- mermaid:block getting-started.overview -->\n"
          + "```mermaid\n"
          + "flowchart TD\n"
          + "Idea[Write once] --> Shared[Reuse shared Mermaid blocks]\n"
          + "Shared --> Publish[Build with mdmm]\n"
          + "```\n"
          + "<!-- /mermaid:block -->\n",
      },
      {
        path: path.join(docsDir, "index.md"),
        content: "# Docs\n\n"
          + "```mermaid-include\n"
          + "getting-started.overview\n"
          + "```\n",
      },
    );
  }

  return plannedFiles;
}

async function assertWritableFile(filePath, force) {
  try {
    const fileStats = await stat(filePath);
    if (fileStats.isFile() && !force) {
      throw new MermaidIncludeError(
        `Refusing to overwrite existing file ${path.relative(process.cwd(), filePath)} without --force`,
        {
          code: "INIT_FILE_EXISTS",
          filePath,
        },
      );
    }
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return;
    }

    throw error;
  }
}

function isNegativeAnswer(value) {
  return ["n", "no"].includes(value.trim().toLowerCase());
}
