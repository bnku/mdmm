# MDMM CLI Workflows

This reference explains the common command surface and when to use each command.

## Runtime Assumptions

`mdmm` may be available in different ways depending on the project:

```bash
mdmm --help
node_modules/.bin/mdmm --help
npx @bnku/mdmm --help
```

For automated work in a non-interactive environment, prefer explicit commands and flags.

## Node Requirement

`mdmm` requires Node.js 22 or newer.

## Project Layout Defaults

Without config, `mdmm` assumes:
- `docs/` for source Markdown documents;
- `shared/` for reusable Mermaid library files;
- `dist/` for directory build output.

Optional config file:

```json
{
  "docsDir": "docs",
  "sharedDir": "shared",
  "outputDir": "dist"
}
```

All fields are optional.

## `mdmm init`

Creates a new documentation project structure.

```bash
mdmm init
mdmm init --yes
mdmm init --yes --no-starter
mdmm init --force
```

Default behavior:
- creates `mdmm.config.json`;
- creates `docs/`, `shared/`, and `dist/`;
- adds starter Markdown files unless `--no-starter` is used.

Flags:
- `--yes`: accept defaults without interactive prompts;
- `--force`: allow overwriting files created by init;
- `--no-starter`: create structure and config without starter Markdown files.

Use `--yes` in automation or non-interactive terminal sessions.

## `mdmm check`

Fast structural validation without writing output files.

```bash
mdmm check
mdmm check ./docs
mdmm check ./docs/customer-flow.md
mdmm check ./docs --max-include-depth 8
```

Checks:
- referenced files and block ids exist;
- short and explicit references resolve correctly;
- fragment aliases and exports are valid;
- template arguments are known and complete;
- include nesting stays within the configured depth limit.

Does not do:
- final Mermaid validation;
- output file writes.

## `mdmm build`

Builds final Markdown with expanded includes.

```bash
mdmm build
mdmm build ./docs --output ./dist/docs
mdmm build ./docs/customer-flow.md
mdmm build ./docs/customer-flow.md --output ./dist/customer-flow.md
mdmm build ./docs --no-validate
```

Behavior:
- expands diagram includes and fragment includes;
- substitutes template arguments;
- validates final Mermaid blocks by default;
- writes output to a file or directory depending on input mode.

Defaults:
- file input without `--output`: print built Markdown to stdout;
- file input with `--output`: write to that file;
- directory input without `--output`: write to configured `outputDir` or `./dist`;
- directory input with `--output`: write to that directory.

Important details:
- `build` may fail even if `check` succeeds, because final Mermaid can still be invalid after expansion;
- directory builds are intended to avoid partial output when validation fails;
- recursive directory builds process Markdown files and skip shared/output directories when the project root is scanned.

## `mdmm report`

Builds a JSON dependency report for reuse analysis.

```bash
mdmm report
mdmm report ./docs --output ./dist/dependencies.json
mdmm report ./docs/customer-flow.md
```

Useful when:
- changing a shared block with unknown downstream consumers;
- auditing which documents use which diagrams or fragments;
- estimating migration or cleanup impact.

Typical report contents:
- processed Markdown files;
- each dependency per file;
- dependency kind such as diagram or fragment;
- source reference text;
- target file and block id;
- fragment alias;
- template arguments passed at the call site;
- usage summary across blocks.

## `mdmm adopt`

Reserved command only.

```bash
mdmm adopt
```

Current expectation:
- do not rely on it for migration;
- do not represent it as a working auto-adoption flow;
- use `report` plus manual editing instead.

## Troubleshooting Guide

If `check` fails:
- verify whether the block id exists;
- verify whether a short ref is unique within `sharedDir`;
- verify whether an explicit path is resolved relative to the calling document;
- verify whether required template arguments were passed;
- verify whether fragment `exports` include the nodes referenced from outside.

If `build` fails after `check` passed:
- the expanded Mermaid may be syntactically invalid;
- fragment composition may have produced bad graph wiring;
- include expansion may have created a structurally valid MDMM program but invalid Mermaid text.

If a project has no config:
- assume `docs/`, `shared/`, `dist/`;
- create `mdmm.config.json` only if the user wants persistent non-default paths.
