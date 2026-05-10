import path from "node:path";
import process from "node:process";

import { MermaidIncludeError } from "./errors.js";

const ARG_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*/;
const FRAGMENT_INCLUDE_PREFIX = "%% include:";

export function parseBlockIncludeDirective(rawReference, currentFilePath, sourceName) {
  const lines = rawReference
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    throw new MermaidIncludeError(
      `Each ${sourceName} block must start with one non-empty reference in ${path.relative(process.cwd(), currentFilePath)}`,
      {
        code: "INVALID_INCLUDE_DIRECTIVE",
      },
    );
  }

  const invocation = parseReferenceInvocation(lines[0], currentFilePath, sourceName, lines[0]);
  const args = parseInlineArgs(invocation.remainder, currentFilePath, sourceName, lines[0]);

  for (const line of lines.slice(1)) {
    if (!looksLikeAssignment(line)) {
      throw new MermaidIncludeError(
        `Each ${sourceName} block must contain one reference followed by optional template arguments in ${path.relative(process.cwd(), currentFilePath)}`,
        {
          code: "INVALID_INCLUDE_DIRECTIVE",
        },
      );
    }

    const assignment = parseAssignmentLine(line, currentFilePath, `${sourceName} block`);
    assignArgument(args, assignment.key, assignment.value, currentFilePath, `${sourceName} block`);
  }

  return {
    referenceText: invocation.referenceText,
    args,
  };
}

export const parseDiagramIncludeDirective = parseBlockIncludeDirective;

export function parseFragmentIncludeDirectiveGroup(lines, startIndex, currentFilePath) {
  const directiveLine = lines[startIndex];
  const trimmed = directiveLine.trim();

  if (!trimmed.startsWith(FRAGMENT_INCLUDE_PREFIX)) {
    return null;
  }

  const invocationText = trimmed.slice(FRAGMENT_INCLUDE_PREFIX.length).trim();
  const invocation = parseReferenceInvocation(invocationText, currentFilePath, "fragment include", trimmed);
  const aliasMatch = invocation.remainder.match(/^as\s+([A-Za-z][A-Za-z0-9_-]*)(?:\s+(.*))?$/);

  if (!aliasMatch) {
    if (/\bas\b/.test(invocation.remainder)) {
      throw new MermaidIncludeError(
        `Invalid fragment include directive in ${path.relative(process.cwd(), currentFilePath)}: ${trimmed}`,
        {
          code: "INVALID_FRAGMENT_INCLUDE_DIRECTIVE",
        },
      );
    }

    throw new MermaidIncludeError(
      `Fragment include is missing alias in ${path.relative(process.cwd(), currentFilePath)}: ${trimmed}`,
      {
        code: "MISSING_ALIAS",
      },
    );
  }

  const args = parseInlineArgs(aliasMatch[2] ?? "", currentFilePath, "fragment include", trimmed);
  let consumedLineCount = 1;

  while (startIndex + consumedLineCount < lines.length) {
    const rawLine = lines[startIndex + consumedLineCount].trim();
    if (!rawLine.startsWith("%%") || rawLine.startsWith(FRAGMENT_INCLUDE_PREFIX)) {
      break;
    }

    const commentBody = rawLine.slice(2).trim();
    if (!looksLikeAssignment(commentBody)) {
      break;
    }

    const assignment = parseAssignmentLine(commentBody, currentFilePath, "fragment include");
    assignArgument(args, assignment.key, assignment.value, currentFilePath, "fragment include");
    consumedLineCount += 1;
  }

  return {
    referenceText: invocation.referenceText,
    alias: aliasMatch[1],
    args,
    consumedLineCount,
  };
}

export function looksLikeAssignment(line) {
  return /^[A-Za-z][A-Za-z0-9_-]*\s*=/.test(line.trim());
}

function parseReferenceInvocation(line, currentFilePath, sourceName, originalLine) {
  const trimmedLine = line.trim();
  const match = trimmedLine.match(/^(\S+)(?:\s+(.*))?$/);

  if (!match) {
    throw new MermaidIncludeError(
      `Invalid ${sourceName} reference ${JSON.stringify(line)} in ${path.relative(process.cwd(), currentFilePath)}. Expected <block-id> or ./path/to/file.md#block-id`,
      {
        code: "INVALID_INCLUDE_REFERENCE",
      },
    );
  }

  const referenceText = match[1];
  const remainder = match[2] ?? "";

  return {
    referenceText,
    remainder,
  };
}

function parseInlineArgs(rawArgs, currentFilePath, sourceName, originalLine) {
  const args = {};
  let index = 0;

  while (index < rawArgs.length) {
    index = skipWhitespace(rawArgs, index);
    if (index >= rawArgs.length) {
      break;
    }

    const keyMatch = rawArgs.slice(index).match(ARG_KEY_PATTERN);
    if (!keyMatch) {
      throwInvalidArgumentSyntax(currentFilePath, sourceName, originalLine);
    }

    const key = keyMatch[0];
    index += key.length;
    index = skipWhitespace(rawArgs, index);

    if (rawArgs[index] !== "=") {
      throwInvalidArgumentSyntax(currentFilePath, sourceName, originalLine);
    }

    index += 1;
    index = skipWhitespace(rawArgs, index);

    const parsedValue = parseInlineValue(rawArgs, index, currentFilePath, sourceName, originalLine);
    assignArgument(args, key, parsedValue.value, currentFilePath, sourceName);
    index = parsedValue.index;
  }

  return args;
}

function parseAssignmentLine(line, currentFilePath, sourceName) {
  const trimmedLine = line.trim();
  const keyMatch = trimmedLine.match(ARG_KEY_PATTERN);

  if (!keyMatch) {
    throwInvalidArgumentSyntax(currentFilePath, sourceName, line);
  }

  const key = keyMatch[0];
  let index = key.length;
  index = skipWhitespace(trimmedLine, index);

  if (trimmedLine[index] !== "=") {
    throwInvalidArgumentSyntax(currentFilePath, sourceName, line);
  }

  index += 1;
  index = skipWhitespace(trimmedLine, index);
  if (index >= trimmedLine.length) {
    throwInvalidArgumentSyntax(currentFilePath, sourceName, line);
  }

  if (trimmedLine[index] === '"' || trimmedLine[index] === "'") {
    const parsedValue = parseQuotedValue(trimmedLine, index, currentFilePath, sourceName, line);
    const trailing = trimmedLine.slice(parsedValue.index).trim();
    if (trailing) {
      throwInvalidArgumentSyntax(currentFilePath, sourceName, line);
    }

    return {
      key,
      value: parsedValue.value,
    };
  }

  return {
    key,
    value: trimmedLine.slice(index).trim(),
  };
}

function parseInlineValue(rawArgs, startIndex, currentFilePath, sourceName, originalLine) {
  if (startIndex >= rawArgs.length) {
    throwInvalidArgumentSyntax(currentFilePath, sourceName, originalLine);
  }

  if (rawArgs[startIndex] === '"' || rawArgs[startIndex] === "'") {
    return parseQuotedValue(rawArgs, startIndex, currentFilePath, sourceName, originalLine);
  }

  let endIndex = startIndex;
  while (endIndex < rawArgs.length && !/\s/.test(rawArgs[endIndex])) {
    endIndex += 1;
  }

  if (endIndex === startIndex) {
    throwInvalidArgumentSyntax(currentFilePath, sourceName, originalLine);
  }

  return {
    value: rawArgs.slice(startIndex, endIndex),
    index: endIndex,
  };
}

function parseQuotedValue(rawText, startIndex, currentFilePath, sourceName, originalLine) {
  const quote = rawText[startIndex];
  let value = "";
  let index = startIndex + 1;

  while (index < rawText.length) {
    const character = rawText[index];

    if (character === "\\") {
      if (index + 1 >= rawText.length) {
        throwInvalidArgumentSyntax(currentFilePath, sourceName, originalLine);
      }

      value += rawText[index + 1];
      index += 2;
      continue;
    }

    if (character === quote) {
      return {
        value,
        index: index + 1,
      };
    }

    value += character;
    index += 1;
  }

  throwInvalidArgumentSyntax(currentFilePath, sourceName, originalLine);
}

function assignArgument(args, key, value, currentFilePath, sourceName) {
  if (Object.hasOwn(args, key)) {
    throw new MermaidIncludeError(
      `Duplicate template argument ${key} in ${sourceName} in ${path.relative(process.cwd(), currentFilePath)}`,
      {
        code: "DUPLICATE_TEMPLATE_ARG",
        key,
      },
    );
  }

  args[key] = value;
}

function skipWhitespace(rawText, index) {
  while (index < rawText.length && /\s/.test(rawText[index])) {
    index += 1;
  }

  return index;
}

function throwInvalidArgumentSyntax(currentFilePath, sourceName, originalLine) {
  throw new MermaidIncludeError(
    `Invalid template argument syntax in ${sourceName} in ${path.relative(process.cwd(), currentFilePath)}: ${originalLine.trim()}`,
    {
      code: "INVALID_TEMPLATE_ARG_SYNTAX",
    },
  );
}
