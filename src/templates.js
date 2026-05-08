import path from "node:path";
import process from "node:process";

import { MermaidIncludeError } from "./errors.js";

const PLACEHOLDER_PATTERN = /%([A-Za-z][A-Za-z0-9_-]*)(?:\|([^%\r\n]*))?%/g;

export function renderTemplate(templateText, args, location) {
  const parameters = collectTemplateParameters(templateText, location);

  for (const key of Object.keys(args)) {
    if (!parameters.has(key)) {
      throw new MermaidIncludeError(
        `Unknown template argument ${key} in ${formatLocation(location)}`,
        {
          code: "UNKNOWN_TEMPLATE_ARG",
          key,
          blockKey: formatBlockKey(location),
        },
      );
    }
  }

  return templateText.replace(PLACEHOLDER_PATTERN, (fullMatch, key, defaultValue) => {
    if (Object.hasOwn(args, key)) {
      return args[key];
    }

    if (defaultValue !== undefined) {
      return defaultValue;
    }

    throw new MermaidIncludeError(`Template argument ${key} is required in ${formatLocation(location)}`, {
      code: "MISSING_TEMPLATE_ARG",
      key,
      blockKey: formatBlockKey(location),
    });
  });
}

export function normalizeTemplateArgs(args) {
  return Object.fromEntries(Object.entries(args).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)));
}

function collectTemplateParameters(templateText, location) {
  const parameters = new Map();

  for (const match of templateText.matchAll(PLACEHOLDER_PATTERN)) {
    const key = match[1];
    const defaultValue = match[2];
    const existing = parameters.get(key);

    if (!existing) {
      parameters.set(key, {
        hasDefault: defaultValue !== undefined,
        defaultValue,
      });
      continue;
    }

    const hasDefault = defaultValue !== undefined;
    if (existing.hasDefault !== hasDefault || existing.defaultValue !== defaultValue) {
      throw new MermaidIncludeError(
        `Template argument ${key} has inconsistent placeholder definitions in ${formatLocation(location)}`,
        {
          code: "INVALID_TEMPLATE_PLACEHOLDER",
          key,
          blockKey: formatBlockKey(location),
        },
      );
    }
  }

  return parameters;
}

function formatLocation(location) {
  if (!location.blockId) {
    return path.relative(process.cwd(), location.filePath);
  }

  return `block ${location.blockId} in ${path.relative(process.cwd(), location.filePath)}`;
}

function formatBlockKey(location) {
  if (!location.blockId) {
    return null;
  }

  return `${path.relative(process.cwd(), location.filePath)}#${location.blockId}`;
}
