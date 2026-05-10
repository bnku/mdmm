import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { startDevSession } from "../src/dev.js";
import { createLogger } from "../src/logger.js";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(projectRoot, "src", "cli.js");

async function createWorkspace() {
  return mkdtemp(path.join(tmpdir(), "mdmm-dev-"));
}

async function writeWorkspaceFile(rootDir, relativePath, content) {
  const absolutePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
  return absolutePath;
}

function createCaptureStream({ isTTY = false } = {}) {
  return {
    isTTY,
    output: "",
    write(chunk) {
      this.output += chunk;
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCondition(check, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5000;
  const intervalMs = options.intervalMs ?? 50;
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      if (await check()) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(intervalMs);
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error(`Timed out after ${timeoutMs}ms`);
}

function createTestLogger() {
  const stdout = createCaptureStream();
  const stderr = createCaptureStream();

  return {
    logger: createLogger({ stdout, stderr, noColor: true }),
    stdout,
    stderr,
  };
}

test("dev command help prints usage", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "dev", "--help"], {
    cwd: projectRoot,
  });

  assert.match(stdout, /mdmm dev/);
  assert.match(stdout, /selectively rebuilds only affected Markdown output/);
});

test("startDevSession rejects single file input", async () => {
  const rootDir = await createWorkspace();
  const { logger } = createTestLogger();
  const inputPath = await writeWorkspaceFile(rootDir, "docs/one.md", "# One\n");

  await assert.rejects(
    () =>
      startDevSession({
        cwd: rootDir,
        logger,
        inputPath,
      }),
    /directory input only/,
  );
});

test("dev selectively rebuilds only affected documents", async () => {
  const rootDir = await createWorkspace();
  const { logger, stdout } = createTestLogger();

  await writeWorkspaceFile(
    rootDir,
    "shared/one.md",
    `<!-- mermaid:block customer.one -->
\`\`\`mermaid
flowchart TD
A --> B
\`\`\`
<!-- /mermaid:block -->
`,
  );
  await writeWorkspaceFile(
    rootDir,
    "shared/two.md",
    `<!-- mermaid:block customer.two -->
\`\`\`mermaid
flowchart TD
X --> Y
\`\`\`
<!-- /mermaid:block -->
`,
  );
  await writeWorkspaceFile(
    rootDir,
    "docs/one.md",
    `\`\`\`mermaid-include
customer.one
\`\`\`
`,
  );
  await writeWorkspaceFile(
    rootDir,
    "docs/two.md",
    `\`\`\`mermaid-include
customer.two
\`\`\`
`,
  );

  const session = await startDevSession({
    cwd: rootDir,
    logger,
  });

  try {
    const outputOnePath = path.join(rootDir, "dist", "one.md");
    const outputTwoPath = path.join(rootDir, "dist", "two.md");

    assert.match(await readFile(outputOnePath, "utf8"), /A --> B/);
    assert.match(await readFile(outputTwoPath, "utf8"), /X --> Y/);

    const initialOutputTwoStat = await stat(outputTwoPath);
    await sleep(150);

    await writeWorkspaceFile(
      rootDir,
      "shared/one.md",
      `<!-- mermaid:block customer.one -->
\`\`\`mermaid
flowchart TD
A --> C
\`\`\`
<!-- /mermaid:block -->
`,
    );

    await waitForCondition(async () => {
      const built = await readFile(outputOnePath, "utf8");
      return built.includes("A --> C");
    });

    const nextOutputTwoStat = await stat(outputTwoPath);
    assert.equal(nextOutputTwoStat.mtimeMs, initialOutputTwoStat.mtimeMs);
    assert.match(stdout.output, /Rebuilt dist\/one\.md \(watch update\)/);
  } finally {
    await session.close();
  }
});

test("dev keeps last good output after build failure and recovers on the next change", async () => {
  const rootDir = await createWorkspace();
  const { logger, stderr } = createTestLogger();

  await writeWorkspaceFile(
    rootDir,
    "shared/library.md",
    `<!-- mermaid:block customer.overview -->
\`\`\`mermaid
flowchart TD
A --> B
\`\`\`
<!-- /mermaid:block -->
`,
  );
  await writeWorkspaceFile(
    rootDir,
    "docs/one.md",
    `\`\`\`mermaid-include
customer.overview
\`\`\`
`,
  );

  const session = await startDevSession({
    cwd: rootDir,
    logger,
  });

  try {
    const outputPath = path.join(rootDir, "dist", "one.md");
    assert.match(await readFile(outputPath, "utf8"), /A --> B/);

    await sleep(150);
    await writeWorkspaceFile(
      rootDir,
      "shared/library.md",
      `<!-- mermaid:block customer.overview -->
\`\`\`mermaid
flowchart TD
A --->
\`\`\`
<!-- /mermaid:block -->
`,
    );

    await waitForCondition(() => stderr.output.includes("Build failed in docs/one.md"));
    assert.match(await readFile(outputPath, "utf8"), /A --> B/);

    await sleep(150);
    await writeWorkspaceFile(
      rootDir,
      "shared/library.md",
      `<!-- mermaid:block customer.overview -->
\`\`\`mermaid
flowchart TD
A --> D
\`\`\`
<!-- /mermaid:block -->
`,
    );

    await waitForCondition(async () => {
      const built = await readFile(outputPath, "utf8");
      return built.includes("A --> D");
    });
  } finally {
    await session.close();
  }
});

test("dev rebuilds short reference users when a new duplicate block appears", async () => {
  const rootDir = await createWorkspace();
  const { logger, stderr } = createTestLogger();

  await writeWorkspaceFile(
    rootDir,
    "shared/one.md",
    `<!-- mermaid:block customer.overview -->
\`\`\`mermaid
flowchart TD
A --> B
\`\`\`
<!-- /mermaid:block -->
`,
  );
  await writeWorkspaceFile(
    rootDir,
    "docs/one.md",
    `\`\`\`mermaid-include
customer.overview
\`\`\`
`,
  );

  const session = await startDevSession({
    cwd: rootDir,
    logger,
  });

  try {
    const outputPath = path.join(rootDir, "dist", "one.md");
    const initialOutputStat = await stat(outputPath);

    await sleep(150);
    await writeWorkspaceFile(
      rootDir,
      "shared/two.md",
      `<!-- mermaid:block customer.overview -->
\`\`\`mermaid
flowchart TD
X --> Y
\`\`\`
<!-- /mermaid:block -->
`,
    );

    await waitForCondition(() => stderr.output.includes("Short reference customer.overview is ambiguous"));
    const failedOutputStat = await stat(outputPath);
    assert.equal(failedOutputStat.mtimeMs, initialOutputStat.mtimeMs);

    await sleep(150);
    await writeWorkspaceFile(
      rootDir,
      "shared/two.md",
      `<!-- mermaid:block customer.secondary -->
\`\`\`mermaid
flowchart TD
X --> Y
\`\`\`
<!-- /mermaid:block -->
`,
    );

    await waitForCondition(async () => {
      const nextOutputStat = await stat(outputPath);
      return nextOutputStat.mtimeMs > initialOutputStat.mtimeMs;
    });
  } finally {
    await session.close();
  }
});

test("dev scopes short reference invalidation by block type", async () => {
  const rootDir = await createWorkspace();
  const { logger, stderr } = createTestLogger();

  await writeWorkspaceFile(
    rootDir,
    "shared/diagram.md",
    `<!-- mermaid:block customer.shared -->
\`\`\`mermaid
flowchart TD
Diagram --> Done
\`\`\`
<!-- /mermaid:block -->
`,
  );
  await writeWorkspaceFile(
    rootDir,
    "shared/content.md",
    `<!-- markdown:block customer.shared -->
Shared Markdown section.
<!-- /markdown:block -->
`,
  );
  await writeWorkspaceFile(
    rootDir,
    "docs/diagram.md",
    `\`\`\`mermaid-include
customer.shared
\`\`\`
`,
  );
  await writeWorkspaceFile(
    rootDir,
    "docs/content.md",
    `\`\`\`markdown-include
customer.shared
\`\`\`
`,
  );

  const session = await startDevSession({
    cwd: rootDir,
    logger,
  });

  try {
    const diagramOutputPath = path.join(rootDir, "dist", "diagram.md");
    const contentOutputPath = path.join(rootDir, "dist", "content.md");

    assert.match(await readFile(diagramOutputPath, "utf8"), /Diagram --> Done/);
    assert.match(await readFile(contentOutputPath, "utf8"), /Shared Markdown section\./);

    const initialContentStat = await stat(contentOutputPath);

    await sleep(150);
    await writeWorkspaceFile(
      rootDir,
      "shared/diagram-duplicate.md",
      `<!-- mm:block customer.shared -->
\`\`\`mermaid
flowchart TD
Other --> Path
\`\`\`
<!-- /mm:block -->
`,
    );

    await waitForCondition(() => stderr.output.includes("Short reference customer.shared is ambiguous"));
    const failedContentStat = await stat(contentOutputPath);
    assert.equal(failedContentStat.mtimeMs, initialContentStat.mtimeMs);
    assert.match(await readFile(contentOutputPath, "utf8"), /Shared Markdown section\./);
  } finally {
    await session.close();
  }
});
