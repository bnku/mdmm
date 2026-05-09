import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { MermaidIncludeError } from "./errors.js";
import { isSameOrNestedPath } from "./project.js";

export async function listMarkdownFiles(rootDir, options = {}) {
  const ignoredDirs = options.ignoredDirs ?? [];
  const allowMissing = options.allowMissing ?? false;

  let rootStats;

  try {
    rootStats = await stat(rootDir);
  } catch (error) {
    if (allowMissing && error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  if (!rootStats.isDirectory()) {
    return [];
  }

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

export function getIgnoredDirs(inputPath, projectSettings) {
  return [projectSettings.sharedDir, projectSettings.outputDir].filter(
    (dirPath) => dirPath !== inputPath && isSameOrNestedPath(inputPath, dirPath),
  );
}

export async function statInputPath(inputPath, cwd) {
  try {
    return await stat(inputPath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new MermaidIncludeError(`Input path not found: ${path.relative(cwd, inputPath)}`, {
        code: "MISSING_INPUT",
      });
    }

    throw error;
  }
}

export async function writeTextFile(outputPath, content) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content, "utf8");
}

export async function removeFileIfExists(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      throw error;
    }
  }
}
