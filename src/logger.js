import process from "node:process";

const ANSI_RESET = "\u001B[0m";
const ANSI_GREEN = "\u001B[32m";
const ANSI_YELLOW = "\u001B[33m";
const ANSI_RED = "\u001B[31m";

export function createLogger(options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const colorEnabled = isColorEnabled({
    stream: stdout,
    env: options.env ?? process.env,
    noColor: options.noColor ?? false,
    forceColor: options.forceColor,
  });

  return {
    colorEnabled,
    info(message) {
      stdout.write(`${message}\n`);
    },
    success(message) {
      stdout.write(`${colorize(message, ANSI_GREEN, colorEnabled)}\n`);
    },
    warn(message) {
      stderr.write(`${colorize(message, ANSI_YELLOW, colorEnabled)}\n`);
    },
    error(message) {
      stderr.write(`${colorize(message, ANSI_RED, colorEnabled)}\n`);
    },
    write(message) {
      stdout.write(message);
    },
  };
}

export function isColorEnabled(options = {}) {
  if (options.forceColor !== undefined) {
    return Boolean(options.forceColor);
  }

  if (options.noColor) {
    return false;
  }

  const env = options.env ?? process.env;
  if (Object.hasOwn(env, "NO_COLOR")) {
    return false;
  }

  return Boolean(options.stream?.isTTY);
}

function colorize(message, colorCode, colorEnabled) {
  if (!colorEnabled) {
    return message;
  }

  return `${colorCode}${message}${ANSI_RESET}`;
}
