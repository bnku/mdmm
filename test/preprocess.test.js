import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { loadProjectSettings } from "../src/project.js";
import { MermaidIncludeError, preprocessFile } from "../src/preprocess.js";
import { collectFileDependencies, buildDependencyReport } from "../src/report.js";
import { resolveBlockReference, resolveReferenceText } from "../src/references.js";

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

test("builds markdown with short block reference using cwd defaults", async () => {
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
customer.overview
\`\`\`
`,
  );

  const output = await preprocessFile(inputPath, undefined, { cwd: rootDir });
  assert.match(output, /flowchart TD\nA --> B/);
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

test("fails when short block reference is ambiguous", async () => {
  const rootDir = await createWorkspace();

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
    "shared/two.md",
    `<!-- mermaid:block customer.overview -->
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
customer.overview
\`\`\`
`,
  );

  await assert.rejects(() => preprocessFile(inputPath, undefined, { cwd: rootDir }), (error) => {
    assert.ok(error instanceof MermaidIncludeError);
    assert.equal(error.details.code, "AMBIGUOUS_BLOCK_REFERENCE");
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
\`\`\`mermaid
flowchart RL
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
  assert.doesNotMatch(output, /flowchart RL/);
  assert.doesNotMatch(output, /%% include:/);
});

test("builds mermaid diagram with short fragment reference using cwd defaults", async () => {
  const rootDir = await createWorkspace();

  await writeWorkspaceFile(
    rootDir,
    "shared/fragments.md",
    `<!-- mermaid:block customer.fragment type=fragment exports=entry,success -->
\`\`\`mermaid
flowchart TD
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
flowchart LR
Begin --> flow__entry
%% include: customer.fragment as flow
flow__success --> Finish
\`\`\`
`,
  );

  const output = await preprocessFile(inputPath, undefined, { cwd: rootDir });
  assert.match(output, /flow__entry\[Start\]/);
  assert.match(output, /flow__success --> Finish/);
});

test("supports reusing one fragment with different aliases", async () => {
  const rootDir = await createWorkspace();

  await writeWorkspaceFile(
    rootDir,
    "shared/fragments.md",
    `<!-- mermaid:block customer.fragment type=fragment exports=entry,success -->
\`\`\`mermaid
flowchart LR
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
\`\`\`mermaid
flowchart TD
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
\`\`\`mermaid
flowchart TD
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
\`\`\`mermaid
flowchart TD
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

test("build command uses config defaults when no arguments are provided", async () => {
  const rootDir = await createWorkspace();

  await writeWorkspaceFile(
    rootDir,
    "mermaid-include.config.json",
    `{
  "docsDir": "docs",
  "sharedDir": "shared",
  "outputDir": "public"
}
`,
  );

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

  const { stdout } = await execFileAsync(process.execPath, [cliPath, "build"], {
    cwd: rootDir,
  });

  assert.match(stdout, /Built public\/one\.md/);
  const built = await readFile(path.join(rootDir, "public", "one.md"), "utf8");
  assert.match(built, /flowchart TD/);
});

test("root directory check ignores shared and output directories from config", async () => {
  const rootDir = await createWorkspace();

  await writeWorkspaceFile(
    rootDir,
    "mermaid-include.config.json",
    `{
  "docsDir": "docs",
  "sharedDir": "shared",
  "outputDir": "dist"
}
`,
  );

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

  await writeWorkspaceFile(
    rootDir,
    "dist/skip-me.md",
    `\`\`\`mermaid-include
broken.block
\`\`\`
`,
  );

  const { stdout } = await execFileAsync(process.execPath, [cliPath, "check", rootDir], {
    cwd: rootDir,
  });

  assert.match(stdout, /OK .*docs\/one\.md/);
  assert.doesNotMatch(stdout, /skip-me\.md/);
  assert.match(stdout, /Checked 1 Markdown file\(s\) under/);
});

test("directory mode rejects invalid config json", async () => {
  const rootDir = await createWorkspace();
  const docsDir = path.join(rootDir, "docs");

  await writeWorkspaceFile(rootDir, "mermaid-include.config.json", `{ invalid json`);
  await writeWorkspaceFile(rootDir, "docs/one.md", `# Empty\n`);

  await assert.rejects(
    () => execFileAsync(process.execPath, [cliPath, "check", docsDir], { cwd: projectRoot }),
    (error) => {
      assert.match(error.stderr, /Invalid JSON in .*mermaid-include\.config\.json/);
      return true;
    },
  );
});

test("directory mode rejects deprecated include exclude config fields", async () => {
  const rootDir = await createWorkspace();
  const docsDir = path.join(rootDir, "docs");

  await writeWorkspaceFile(
    rootDir,
    "mermaid-include.config.json",
    `{
  "include": ["docs/**/*.md"]
}
`,
  );
  await writeWorkspaceFile(rootDir, "docs/one.md", `# Empty\n`);

  await assert.rejects(
    () => execFileAsync(process.execPath, [cliPath, "check", docsDir], { cwd: rootDir }),
    (error) => {
      assert.match(error.stderr, /deprecated include\/exclude fields/);
      return true;
    },
  );
});

test("report command returns dependency map for a single file", async () => {
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

<!-- mermaid:block customer.fragment type=fragment exports=entry,success -->
\`\`\`mermaid
flowchart TD
entry[Start]
entry --> success[Done]
\`\`\`
<!-- /mermaid:block -->
`,
  );

  const inputPath = await writeWorkspaceFile(
    rootDir,
    "docs/journey.md",
    `# Journey

\`\`\`mermaid-include
customer.overview
\`\`\`

\`\`\`mermaid
flowchart LR
Start --> kyc__entry
%% include: customer.fragment as kyc
kyc__success --> Done
\`\`\`
`,
  );

  const { stdout } = await execFileAsync(process.execPath, [cliPath, "report", inputPath], {
    cwd: rootDir,
  });

  const report = JSON.parse(stdout);
  assert.equal(report.summary.fileCount, 1);
  assert.equal(report.summary.dependencyCount, 2);
  assert.equal(report.summary.blockCount, 2);
  assert.equal(report.files[0].dependencies[0].type, "diagram");
  assert.equal(report.files[0].dependencies[1].type, "fragment");
  assert.equal(report.files[0].dependencies[1].alias, "kyc");
});

test("report command ignores shared and output directories when run from project root", async () => {
  const rootDir = await createWorkspace();

  await writeWorkspaceFile(
    rootDir,
    "mermaid-include.config.json",
    `{
  "docsDir": "docs",
  "sharedDir": "shared",
  "outputDir": "dist"
}
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

  await writeWorkspaceFile(
    rootDir,
    "shared/library.md",
    `<!-- mermaid:block customer.overview -->
\`\`\`mermaid
flowchart TD
A --> B
\`\`\`
<!-- /mermaid:block -->

<!-- mermaid:block customer.fragment type=fragment exports=entry,success -->
\`\`\`mermaid
flowchart TD
entry[Start]
entry --> success[Done]
\`\`\`
<!-- /mermaid:block -->
`,
  );

  await writeWorkspaceFile(
    rootDir,
    "docs/two.md",
    `\`\`\`mermaid
flowchart LR
Start --> flow__entry
%% include: customer.fragment as flow
flow__success --> Finish
\`\`\`
`,
  );

  await writeWorkspaceFile(
    rootDir,
    "dist/skip.md",
    `\`\`\`mermaid-include
ignored.block
\`\`\`
`,
  );

  const { stdout } = await execFileAsync(process.execPath, [cliPath, "report", rootDir], {
    cwd: rootDir,
  });

  const report = JSON.parse(stdout);
  assert.equal(report.summary.fileCount, 2);
  assert.equal(report.summary.dependencyCount, 2);
  assert.equal(report.blocks.length, 2);
  assert.equal(report.blocks[0].usedBy.length, 1);
  assert.ok(report.files.every((file) => !file.path.endsWith("skip.md")));
});

test("cli help prints usage", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "--help"], {
    cwd: projectRoot,
  });

  assert.match(stdout, /Usage:/);
  assert.match(stdout, /mermaid-include-sync build/);
});

test("cli rejects unknown command", async () => {
  await assert.rejects(
    () => execFileAsync(process.execPath, [cliPath, "wat"], { cwd: projectRoot }),
    (error) => {
      assert.match(error.stderr, /Unknown command: wat/);
      return true;
    },
  );
});

test("cli builds single file to stdout when output path is omitted", async () => {
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
    "docs/one.md",
    `\`\`\`mermaid-include
customer.overview
\`\`\`
`,
  );

  const { stdout } = await execFileAsync(process.execPath, [cliPath, "build", inputPath], {
    cwd: rootDir,
  });

  assert.match(stdout, /```mermaid\nflowchart TD\nA --> B\n```\n$/);
});

test("cli check reports single file success", async () => {
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
    "docs/one.md",
    `\`\`\`mermaid-include
customer.overview
\`\`\`
`,
  );

  const { stdout } = await execFileAsync(process.execPath, [cliPath, "check", inputPath], {
    cwd: rootDir,
  });

  assert.match(stdout, /OK .*docs\/one\.md/);
});

test("cli rejects invalid max include depth", async () => {
  await assert.rejects(
    () => execFileAsync(process.execPath, [cliPath, "check", "--max-include-depth", "0"], { cwd: projectRoot }),
    (error) => {
      assert.match(error.stderr, /--max-include-depth must be a positive integer/);
      return true;
    },
  );
});

test("cli rejects unexpected argument", async () => {
  await assert.rejects(
    () => execFileAsync(process.execPath, [cliPath, "check", "docs", "extra"], { cwd: projectRoot }),
    (error) => {
      assert.match(error.stderr, /Unexpected argument: extra/);
      return true;
    },
  );
});

test("cli without config falls back to cwd docs and reports missing input", async () => {
  const rootDir = await createWorkspace();

  await assert.rejects(
    () => execFileAsync(process.execPath, [cliPath, "check"], { cwd: rootDir }),
    (error) => {
      assert.match(error.stderr, /Input path not found:/);
      return true;
    },
  );
});

test("loadProjectSettings falls back to cwd defaults for missing path", async () => {
  const rootDir = await createWorkspace();
  const settings = await loadProjectSettings(path.join(rootDir, "missing", "docs", "one.md"), { cwd: rootDir });

  assert.equal(settings.configPath, null);
  assert.equal(settings.docsDir, path.join(rootDir, "docs"));
  assert.equal(settings.sharedDir, path.join(rootDir, "shared"));
  assert.equal(settings.outputDir, path.join(rootDir, "dist"));
});

test("loadProjectSettings rejects non-object config", async () => {
  const rootDir = await createWorkspace();
  await writeWorkspaceFile(rootDir, "mermaid-include.config.json", `[]`);

  await assert.rejects(() => loadProjectSettings(rootDir, { cwd: rootDir }), (error) => {
    assert.ok(error instanceof MermaidIncludeError);
    assert.equal(error.details.code, "INVALID_CONFIG");
    assert.match(error.message, /must be a JSON object/);
    return true;
  });
});

test("loadProjectSettings rejects non-string directory fields", async () => {
  const rootDir = await createWorkspace();
  await writeWorkspaceFile(rootDir, "mermaid-include.config.json", `{"sharedDir": 42}`);

  await assert.rejects(() => loadProjectSettings(rootDir, { cwd: rootDir }), (error) => {
    assert.ok(error instanceof MermaidIncludeError);
    assert.equal(error.details.code, "INVALID_CONFIG");
    assert.match(error.message, /sharedDir/);
    return true;
  });
});

test("resolveBlockReference rejects multiple references in one include block", async () => {
  const rootDir = await createWorkspace();
  const context = {
    projectSettings: {
      sharedDir: path.join(rootDir, "shared"),
    },
    sharedBlockIndexPromise: null,
  };

  await assert.rejects(
    () => resolveBlockReference("one\ntwo", path.join(rootDir, "docs", "one.md"), "mermaid-include", context),
    (error) => {
      assert.ok(error instanceof MermaidIncludeError);
      assert.equal(error.details.code, "INVALID_INCLUDE_DIRECTIVE");
      return true;
    },
  );
});

test("resolveReferenceText rejects malformed explicit references", async () => {
  const rootDir = await createWorkspace();
  const context = {
    projectSettings: {
      sharedDir: path.join(rootDir, "shared"),
    },
    sharedBlockIndexPromise: null,
  };

  await assert.rejects(() => resolveReferenceText("broken#", path.join(rootDir, "docs", "one.md"), "mermaid-include", context), (error) => {
    assert.ok(error instanceof MermaidIncludeError);
    assert.equal(error.details.code, "INVALID_INCLUDE_REFERENCE");
    return true;
  });
});

test("resolveReferenceText fails for short reference when shared directory is absent", async () => {
  const rootDir = await createWorkspace();
  const context = {
    projectSettings: {
      sharedDir: path.join(rootDir, "shared"),
    },
    sharedBlockIndexPromise: null,
  };

  await assert.rejects(() => resolveReferenceText("customer.overview", path.join(rootDir, "docs", "one.md"), "mermaid-include", context), (error) => {
    assert.ok(error instanceof MermaidIncludeError);
    assert.equal(error.details.code, "MISSING_BLOCK");
    return true;
  });
});

test("collectFileDependencies rejects fragment include without alias", async () => {
  const rootDir = await createWorkspace();
  const context = {
    projectSettings: {
      sharedDir: path.join(rootDir, "shared"),
    },
    sharedBlockIndexPromise: null,
  };

  await assert.rejects(
    () =>
      collectFileDependencies(
        `\`\`\`mermaid\nflowchart TD\n%% include: customer.fragment\n\`\`\`\n`,
        path.join(rootDir, "docs", "journey.md"),
        context,
      ),
    (error) => {
      assert.ok(error instanceof MermaidIncludeError);
      assert.equal(error.details.code, "MISSING_ALIAS");
      return true;
    },
  );
});

test("buildDependencyReport rejects missing input file", async () => {
  const rootDir = await createWorkspace();

  await assert.rejects(
    () => buildDependencyReport([path.join(rootDir, "docs", "missing.md")], { cwd: rootDir, rootPath: rootDir }),
    (error) => {
      assert.ok(error instanceof MermaidIncludeError);
      assert.equal(error.details.code, "MISSING_FILE");
      return true;
    },
  );
});

test("fails when one diagram reuses the same fragment alias twice", async () => {
  const rootDir = await createWorkspace();

  await writeWorkspaceFile(
    rootDir,
    "shared/fragments.md",
    `<!-- mermaid:block customer.fragment type=fragment exports=entry -->
\`\`\`mermaid
flowchart TD
entry[Start]
\`\`\`
<!-- /mermaid:block -->
`,
  );

  const inputPath = await writeWorkspaceFile(
    rootDir,
    "docs/journey.md",
    `\`\`\`mermaid
flowchart TD
%% include: customer.fragment as flow
%% include: customer.fragment as flow
\`\`\`
`,
  );

  await assert.rejects(() => preprocessFile(inputPath, undefined, { cwd: rootDir }), (error) => {
    assert.ok(error instanceof MermaidIncludeError);
    assert.equal(error.details.code, "DUPLICATE_ALIAS");
    return true;
  });
});

test("fails on malformed fragment include directive", async () => {
  const rootDir = await createWorkspace();
  const inputPath = await writeWorkspaceFile(
    rootDir,
    "docs/journey.md",
    `\`\`\`mermaid
flowchart TD
%% include: customer.fragment as
\`\`\`
`,
  );

  await assert.rejects(() => preprocessFile(inputPath, undefined, { cwd: rootDir }), (error) => {
    assert.ok(error instanceof MermaidIncludeError);
    assert.equal(error.details.code, "INVALID_FRAGMENT_INCLUDE_DIRECTIVE");
    return true;
  });
});

test("fails when fragment export is declared but missing in body", async () => {
  const rootDir = await createWorkspace();

  await writeWorkspaceFile(
    rootDir,
    "shared/fragments.md",
    `<!-- mermaid:block customer.fragment type=fragment exports=entry,missing -->
\`\`\`mermaid
flowchart TD
entry[Start]
\`\`\`
<!-- /mermaid:block -->
`,
  );

  const inputPath = await writeWorkspaceFile(
    rootDir,
    "docs/journey.md",
    `\`\`\`mermaid
flowchart TD
%% include: customer.fragment as flow
\`\`\`
`,
  );

  await assert.rejects(() => preprocessFile(inputPath, undefined, { cwd: rootDir }), (error) => {
    assert.ok(error instanceof MermaidIncludeError);
    assert.equal(error.details.code, "MISSING_EXPORT");
    return true;
  });
});

test("fails when fragment block omits diagram type line", async () => {
  const rootDir = await createWorkspace();

  await writeWorkspaceFile(
    rootDir,
    "shared/fragments.md",
    `<!-- mermaid:block customer.fragment type=fragment exports=entry -->
\`\`\`mermaid
entry[Start]
\`\`\`
<!-- /mermaid:block -->
`,
  );

  const inputPath = await writeWorkspaceFile(
    rootDir,
    "docs/journey.md",
    `\`\`\`mermaid
flowchart TD
%% include: customer.fragment as flow
\`\`\`
`,
  );

  await assert.rejects(() => preprocessFile(inputPath, undefined, { cwd: rootDir }), (error) => {
    assert.ok(error instanceof MermaidIncludeError);
    assert.equal(error.details.code, "INVALID_BLOCK_CONTENT");
    return true;
  });
});

test("fails when diagram block resolves to mermaid-like custom fence", async () => {
  const rootDir = await createWorkspace();

  await writeWorkspaceFile(
    rootDir,
    "shared/library.md",
    `<!-- mermaid:block customer.overview -->
\`\`\`mermaid-fragment
entry[Start]
\`\`\`
<!-- /mermaid:block -->
`,
  );

  const inputPath = await writeWorkspaceFile(
    rootDir,
    "docs/one.md",
    `\`\`\`mermaid-include
customer.overview
\`\`\`
`,
  );

  await assert.rejects(() => preprocessFile(inputPath, undefined, { cwd: rootDir }), (error) => {
    assert.ok(error instanceof MermaidIncludeError);
    assert.equal(error.details.code, "INVALID_BLOCK_CONTENT");
    return true;
  });
});

test("fails when nested include depth exceeds configured maximum", async () => {
  const rootDir = await createWorkspace();

  await writeWorkspaceFile(
    rootDir,
    "shared/level-3.md",
    `<!-- mermaid:block level.three -->
\`\`\`mermaid
flowchart TD
C --> D
\`\`\`
<!-- /mermaid:block -->
`,
  );

  await writeWorkspaceFile(
    rootDir,
    "shared/level-2.md",
    `<!-- mermaid:block level.two -->
\`\`\`mermaid-include
level.three
\`\`\`
<!-- /mermaid:block -->
`,
  );

  await writeWorkspaceFile(
    rootDir,
    "shared/level-1.md",
    `<!-- mermaid:block level.one -->
\`\`\`mermaid-include
level.two
\`\`\`
<!-- /mermaid:block -->
`,
  );

  const inputPath = await writeWorkspaceFile(
    rootDir,
    "docs/one.md",
    `\`\`\`mermaid-include
level.one
\`\`\`
`,
  );

  await assert.rejects(() => preprocessFile(inputPath, undefined, { cwd: rootDir, maxIncludeDepth: 2 }), (error) => {
    assert.ok(error instanceof MermaidIncludeError);
    assert.equal(error.details.code, "MAX_INCLUDE_DEPTH_EXCEEDED");
    return true;
  });
});
