import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { MermaidIncludeError } from "./errors.js";

export const CONFIG_FILE_NAME = "mdmm.config.json";

const DEFAULT_DOCS_DIR = "docs";
const DEFAULT_SHARED_DIR = "shared";
const DEFAULT_OUTPUT_DIR = "dist";

export async function loadProjectSettings(startPath = process.cwd(), options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const resolvedStartPath = path.resolve(startPath);
  const searchDir = await inferSearchDir(resolvedStartPath);
  const configPath = await findConfigPath(searchDir);
  const baseDir = configPath ? path.dirname(configPath) : cwd;
  const config = configPath ? await readProjectConfig(configPath) : {};

  return {
    cwd,
    baseDir,
    configPath,
    docsDir: resolveProjectPath(baseDir, config.docsDir ?? DEFAULT_DOCS_DIR),
    sharedDir: resolveProjectPath(baseDir, config.sharedDir ?? DEFAULT_SHARED_DIR),
    outputDir: resolveProjectPath(baseDir, config.outputDir ?? DEFAULT_OUTPUT_DIR),
  };
}

export function isSameOrNestedPath(parentPath, childPath) {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

async function inferSearchDir(startPath) {
  try {
    const startStats = await stat(startPath);
    return startStats.isDirectory() ? startPath : path.dirname(startPath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return path.dirname(startPath);
    }

    throw error;
  }
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

async function readProjectConfig(configPath) {
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

  if (Object.hasOwn(parsedConfig, "include") || Object.hasOwn(parsedConfig, "exclude")) {
    throw new MermaidIncludeError(
      `Config ${path.relative(process.cwd(), configPath)} uses deprecated include/exclude fields. Use docsDir, sharedDir, and outputDir instead`,
      {
        code: "INVALID_CONFIG",
        configPath,
      },
    );
  }

  return {
    docsDir: normalizeDirectorySetting(parsedConfig.docsDir, "docsDir", configPath),
    sharedDir: normalizeDirectorySetting(parsedConfig.sharedDir, "sharedDir", configPath),
    outputDir: normalizeDirectorySetting(parsedConfig.outputDir, "outputDir", configPath),
  };
}

function normalizeDirectorySetting(value, key, configPath) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new MermaidIncludeError(
      `Config field ${key} in ${path.relative(process.cwd(), configPath)} must be a non-empty string`,
      {
        code: "INVALID_CONFIG",
        configPath,
        key,
      },
    );
  }

  return value.trim();
}

function resolveProjectPath(baseDir, value) {
  return path.resolve(baseDir, value);
}
