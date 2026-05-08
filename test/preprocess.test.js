import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { MermaidIncludeError, preprocessFile } from "../src/preprocess.js";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(projectRoot, "src", "cli.js");

async function createWorkspace() {
  return mkdtemp(path.join(tmpdir(), "mm-test-"));
}

async function writeWorkspaceFile(rootDir, relativePath, content) {
  const absolutePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
  return absolutePath;
}

test("builds markdown with multiple includes", async () => {
  const rootDir = await createWorkspace();

  await writeWorkspaceFile(
    rootDir,
    "shared/library.md",
    `<!-- mermaid:block customer.overview -->
\`\`\`mermaid
flowchart TD
A --> B
\`\`\`
<!-- /mermaid:block -->

<!-- mermaid:block customer.secondary -->
\`\`\`mermaid
flowchart LR
X --> Y
\`\`\`
<!-- /mermaid:block -->
`,
  );

  const inputPath = await writeWorkspaceFile(
    rootDir,
    "docs/process.md",
    `# Process

\`\`\`mermaid-include
../shared/library.md#customer.overview
\`\`\`

\`\`\`mermaid-include
../shared/library.md#customer.secondary
\`\`\`
`,
  );

  const output = await preprocessFile(inputPath);

  assert.match(output, /```mermaid\nflowchart TD\nA --> B\n```/);
  assert.match(output, /```mermaid\nflowchart LR\nX --> Y\n```/);
  assert.doesNotMatch(output, /```mermaid-include/);
});

test("fails when referenced file does not exist", async () => {
  const rootDir = await createWorkspace();
  const inputPath = await writeWorkspaceFile(
    rootDir,
    "docs/process.md",
    `\`\`\`mermaid-include
../shared/missing.md#customer.overview
\`\`\`
`,
  );

  await assert.rejects(() => preprocessFile(inputPath), (error) => {
    assert.ok(error instanceof MermaidIncludeError);
    assert.equal(error.details.code, "MISSING_FILE");
    return true;
  });
});

test("fails when referenced block does not exist", async () => {
  const rootDir = await createWorkspace();

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

  const inputPath = await writeWorkspaceFile(
    rootDir,
    "docs/process.md",
    `\`\`\`mermaid-include
../shared/library.md#customer.unknown
\`\`\`
`,
  );

  await assert.rejects(() => preprocessFile(inputPath), (error) => {
    assert.ok(error instanceof MermaidIncludeError);
    assert.equal(error.details.code, "MISSING_BLOCK");
    return true;
  });
});

test("fails on duplicate block ids inside one file", async () => {
  const rootDir = await createWorkspace();

  await writeWorkspaceFile(
    rootDir,
    "shared/library.md",
    `<!-- mermaid:block customer.overview -->
\`\`\`mermaid
flowchart TD
A --> B
\`\`\`
<!-- /mermaid:block -->

<!-- mermaid:block customer.overview -->
\`\`\`mermaid
flowchart TD
B --> C
\`\`\`
<!-- /mermaid:block -->
`,
  );

  const inputPath = await writeWorkspaceFile(
    rootDir,
    "docs/process.md",
    `\`\`\`mermaid-include
../shared/library.md#customer.overview
\`\`\`
`,
  );

  await assert.rejects(() => preprocessFile(inputPath), (error) => {
    assert.ok(error instanceof MermaidIncludeError);
    assert.equal(error.details.code, "DUPLICATE_BLOCK_ID");
    return true;
  });
});

test("detects cyclic nested includes", async () => {
  const rootDir = await createWorkspace();

  await writeWorkspaceFile(
    rootDir,
    "shared/a.md",
    `<!-- mermaid:block block.a -->
\`\`\`mermaid-include
./b.md#block.b
\`\`\`
<!-- /mermaid:block -->
`,
  );

  await writeWorkspaceFile(
    rootDir,
    "shared/b.md",
    `<!-- mermaid:block block.b -->
\`\`\`mermaid-include
./a.md#block.a
\`\`\`
<!-- /mermaid:block -->
`,
  );

  const inputPath = await writeWorkspaceFile(
    rootDir,
    "docs/process.md",
    `\`\`\`mermaid-include
../shared/a.md#block.a
\`\`\`
`,
  );

  await assert.rejects(() => preprocessFile(inputPath), (error) => {
    assert.ok(error instanceof MermaidIncludeError);
    assert.equal(error.details.code, "CYCLIC_INCLUDE");
    return true;
  });
});

test("supports nested includes within bounded depth", async () => {
  const rootDir = await createWorkspace();

  await writeWorkspaceFile(
    rootDir,
    "shared/base.md",
    `<!-- mermaid:block block.base -->
\`\`\`mermaid
flowchart TD
Base --> Done
\`\`\`
<!-- /mermaid:block -->
`,
  );

  await writeWorkspaceFile(
    rootDir,
    "shared/alias.md",
    `<!-- mermaid:block block.alias -->
\`\`\`mermaid-include
./base.md#block.base
\`\`\`
<!-- /mermaid:block -->
`,
  );

  const inputPath = await writeWorkspaceFile(
    rootDir,
    "docs/process.md",
    `\`\`\`mermaid-include
../shared/alias.md#block.alias
\`\`\`
`,
  );

  const output = await preprocessFile(inputPath, undefined, { maxIncludeDepth: 3 });
  assert.match(output, /Base --> Done/);
});

test("builds mermaid diagram with fragment include and alias rewrite", async () => {
  const rootDir = await createWorkspace();

  await writeWorkspaceFile(
    rootDir,
    "shared/fragments.md",
    `<!-- mermaid:block customer.fragment type=fragment exports=entry,success,fail -->
\`\`\`mermaid-fragment
entry[Start]
entry --> check{Valid?}
check -- Yes --> success[Approved]
check -- No --> fail[Fix]
\`\`\`
<!-- /mermaid:block -->
`,
  );

  const inputPath = await writeWorkspaceFile(
    rootDir,
    "docs/journey.md",
    `\`\`\`mermaid
flowchart LR
Start[Request] --> kyc__entry
%% include: ../shared/fragments.md#customer.fragment as kyc
kyc__success --> Done[Finish]
kyc__fail --> Rework[Retry]
\`\`\`
`,
  );

  const output = await preprocessFile(inputPath);
  assert.match(output, /kyc__entry\[Start\]/);
  assert.match(output, /kyc__entry --> kyc__check\{Valid\?\}/);
  assert.match(output, /kyc__success --> Done\[Finish\]/);
  assert.doesNotMatch(output, /%% include:/);
});

test("supports reusing one fragment with different aliases", async () => {
  const rootDir = await createWorkspace();

  await writeWorkspaceFile(
    rootDir,
    "shared/fragments.md",
    `<!-- mermaid:block customer.fragment type=fragment exports=entry,success -->
\`\`\`mermaid-fragment
entry[Start]
entry --> success[Done]
\`\`\`
<!-- /mermaid:block -->
`,
  );

  const inputPath = await writeWorkspaceFile(
    rootDir,
    "docs/journey.md",
    `\`\`\`mermaid
flowchart TD
Begin --> first__entry
%% include: ../shared/fragments.md#customer.fragment as first
first__success --> second__entry
%% include: ../shared/fragments.md#customer.fragment as second
second__success --> End
\`\`\`
`,
  );

  const output = await preprocessFile(inputPath);
  assert.match(output, /first__entry\[Start\]/);
  assert.match(output, /second__entry\[Start\]/);
  assert.match(output, /second__success --> End/);
});

test("fails when fragment include has no alias", async () => {
  const rootDir = await createWorkspace();

  const inputPath = await writeWorkspaceFile(
    rootDir,
    "docs/journey.md",
    `\`\`\`mermaid
flowchart TD
%% include: ../shared/fragments.md#customer.fragment
\`\`\`
`,
  );

  await assert.rejects(() => preprocessFile(inputPath), (error) => {
    assert.ok(error instanceof MermaidIncludeError);
    assert.equal(error.details.code, "MISSING_ALIAS");
    return true;
  });
});

test("fails when external diagram references non-exported fragment node", async () => {
  const rootDir = await createWorkspace();

  await writeWorkspaceFile(
    rootDir,
    "shared/fragments.md",
    `<!-- mermaid:block customer.fragment type=fragment exports=entry,success -->
\`\`\`mermaid-fragment
entry[Start]
entry --> hidden[Internal]
hidden --> success[Done]
\`\`\`
<!-- /mermaid:block -->
`,
  );

  const inputPath = await writeWorkspaceFile(
    rootDir,
    "docs/journey.md",
    `\`\`\`mermaid
flowchart TD
Begin --> kyc__entry
kyc__hidden --> End
%% include: ../shared/fragments.md#customer.fragment as kyc
\`\`\`
`,
  );

  await assert.rejects(() => preprocessFile(inputPath), (error) => {
    assert.ok(error instanceof MermaidIncludeError);
    assert.equal(error.details.code, "MISSING_EXPORT");
    return true;
  });
});

test("fails when whole-diagram include targets a fragment block", async () => {
  const rootDir = await createWorkspace();

  await writeWorkspaceFile(
    rootDir,
    "shared/fragments.md",
    `<!-- mermaid:block customer.fragment type=fragment exports=entry -->
\`\`\`mermaid-fragment
entry[Start]
\`\`\`
<!-- /mermaid:block -->
`,
  );

  const inputPath = await writeWorkspaceFile(
    rootDir,
    "docs/process.md",
    `\`\`\`mermaid-include
../shared/fragments.md#customer.fragment
\`\`\`
`,
  );

  await assert.rejects(() => preprocessFile(inputPath), (error) => {
    assert.ok(error instanceof MermaidIncludeError);
    assert.equal(error.details.code, "INVALID_BLOCK_TYPE");
    return true;
  });
});

test("build command supports recursive directory mode", async () => {
  const rootDir = await createWorkspace();

  await writeWorkspaceFile(
    rootDir,
    "shared/library.md",
    `<!-- mermaid:block customer.overview -->
\`\`\`mermaid
flowchart TD
A --> B
\`\`\`
<!-- /mermaid:block -->

<!-- mermaid:block customer.fragment type=fragment exports=entry,done -->
\`\`\`mermaid-fragment
entry[Start]
entry --> done[Done]
\`\`\`
<!-- /mermaid:block -->
`,
  );

  const docsDir = path.join(rootDir, "docs");
  const outputDir = path.join(rootDir, "dist");

  await writeWorkspaceFile(
    rootDir,
    "docs/overview.md",
    `\`\`\`mermaid-include
../shared/library.md#customer.overview
\`\`\`
`,
  );

  await writeWorkspaceFile(
    rootDir,
    "docs/nested/journey.md",
    `\`\`\`mermaid
flowchart LR
Start --> flow__entry
%% include: ../../shared/library.md#customer.fragment as flow
flow__done --> Finish
\`\`\`
`,
  );

  const { stdout } = await execFileAsync(process.execPath, [cliPath, "build", docsDir, "--output", outputDir], {
    cwd: projectRoot,
  });

  assert.match(stdout, /Built .*dist\/overview\.md/);
  assert.match(stdout, /Built .*dist\/nested\/journey\.md/);
  assert.match(stdout, /Built 2 Markdown file\(s\) under/);

  const builtOverview = await readFile(path.join(outputDir, "overview.md"), "utf8");
  const builtJourney = await readFile(path.join(outputDir, "nested", "journey.md"), "utf8");

  assert.match(builtOverview, /flowchart TD/);
  assert.match(builtJourney, /flow__entry\[Start\]/);
  assert.match(builtJourney, /flow__done --> Finish/);
});

test("check command supports recursive directory mode", async () => {
  const rootDir = await createWorkspace();

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

  const docsDir = path.join(rootDir, "docs");
  await writeWorkspaceFile(
    rootDir,
    "docs/one.md",
    `\`\`\`mermaid-include
../shared/library.md#customer.overview
\`\`\`
`,
  );
  await writeWorkspaceFile(
    rootDir,
    "docs/two.md",
    `\`\`\`mermaid-include
../shared/library.md#customer.overview
\`\`\`
`,
  );

  const { stdout } = await execFileAsync(process.execPath, [cliPath, "check", docsDir], {
    cwd: projectRoot,
  });

  assert.match(stdout, /OK .*one\.md/);
  assert.match(stdout, /OK .*two\.md/);
  assert.match(stdout, /Checked 2 Markdown file\(s\) under/);
});

test("directory build requires output directory", async () => {
  const rootDir = await createWorkspace();
  const docsDir = path.join(rootDir, "docs");
  await mkdir(docsDir, { recursive: true });

  await assert.rejects(
    () => execFileAsync(process.execPath, [cliPath, "build", docsDir], { cwd: projectRoot }),
    (error) => {
      assert.match(error.stderr, /Directory build requires --output <output-dir>/);
      return true;
    },
  );
});
