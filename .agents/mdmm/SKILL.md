---
name: mdmm
description: >-
  Guides MDMM authoring, validation, builds, and reuse workflows for Markdown +
  Mermaid documentation. Use when creating or editing shared Mermaid blocks,
  adding mermaid-include or fragment includes, running mdmm CLI commands,
  troubleshooting broken references, or preparing publish-ready Markdown.
allowed-tools: Read Glob Grep Bash(mdmm *) Bash(npx @bnku/mdmm *) Bash(node_modules/.bin/mdmm *) Bash(node ./bin/mdmm.js *)
license: MIT
metadata:
  author: OpenCode
  version: "1.0"
  category: documentation
---

# MDMM

Use this skill when the task is about authoring, validating, or building Markdown documentation that reuses Mermaid diagrams through `mdmm`.

This skill is self-contained. Do not assume it lives inside the `mdmm` source repository. It may be installed globally or copied into an unrelated documentation project.

## Purpose

`mdmm` is a CLI workflow for reusing Mermaid diagrams and Mermaid fragments in Markdown documents while keeping the final output as plain Markdown with standard `mermaid` fences.

Use this skill to:
- initialize a new docs project with `mdmm init`;
- add or edit reusable diagram blocks in a shared library;
- include whole diagrams with `mermaid-include`;
- compose larger diagrams with fragment includes;
- validate references, template arguments, and include depth with `mdmm check`;
- build publish-ready Markdown with `mdmm build`;
- inspect reuse and impact with `mdmm report`.

## Operating Rules

1. Treat the current workspace as the user's documentation project, not as the `mdmm` source repo.
2. Detect project layout before changing files:
   - if `mdmm.config.json` exists, read it and use `docsDir`, `sharedDir`, and `outputDir`;
   - if no config exists, assume defaults: `docs/`, `shared/`, `dist/`.
3. Prefer the fastest safe command path that exists in the environment:
   - `mdmm ...`
   - `node_modules/.bin/mdmm ...`
   - `npx @bnku/mdmm ...`
   - `node ./bin/mdmm.js ...` only when the current workspace is the CLI repo itself.
4. During editing, prefer `mdmm check` for fast feedback. Use `mdmm build` when the user needs final output.
5. Do not claim support for automatic migration with `mdmm adopt`. The command is a reserved placeholder, not an implemented retrofit workflow.

## Workflow

1. Identify the user's goal.
2. Inspect project config and relevant Markdown files.
3. Decide whether the change belongs in `shared/`, `docs/`, or both.
4. Apply the smallest change that fits the existing MDMM authoring pattern.
5. Run validation:
   - `mdmm check` for structural correctness;
   - `mdmm build` when final Markdown or final Mermaid validation is needed.
6. If the task is exploratory, run `mdmm report` to map dependencies before editing shared blocks.
7. Explain the result in terms of authoring behavior, not just file diffs.

## Decision Guide

Use `init` when:
- the project does not yet have an `mdmm` structure;
- the user wants starter docs, shared library, and config scaffolding.

Use `check` when:
- references may be broken;
- template arguments changed;
- fragment `alias` or `exports` changed;
- the user wants a fast correctness pass without writing output.

Use `build` when:
- the user needs final Markdown for publication;
- diagram includes must be expanded into standard `mermaid` blocks;
- final Mermaid syntax should be validated.

Use `report` when:
- a shared block may have many downstream consumers;
- the user wants impact analysis before editing a canonical diagram;
- the team is cleaning up or auditing reuse.

## Guardrails

- Keep the authoring model as `Markdown + Mermaid`. Do not invent a new DSL, schema, or sidecar data model unless the user explicitly asks for that.
- Reusable content lives in regular `.md` files.
- Short references depend on globally unique block ids inside the shared library.
- Explicit references use `path/to/file.md#block-id` and are resolved relative to the current document.
- Fragment includes always need `as <alias>`.
- External links into a fragment may target only nodes exported by that fragment.
- Template placeholders are for labels, comments, and argument values. Do not use them for node ids, fragment aliases, or the diagram type line.
- Keep include depth reasonable. If nesting grows, validate with `--max-include-depth` explicitly.
- `check` can succeed while `build` fails, because `build` also validates the final Mermaid result by default.

## Execution Notes

When running commands, adapt to the environment:

```bash
# First choice when mdmm is installed globally
mdmm check

# Common fallback inside a docs project
node_modules/.bin/mdmm build ./docs --output ./dist/docs

# Fallback when no local install exists
npx @bnku/mdmm report ./docs --output ./dist/dependencies.json
```

If you need syntax details or examples, read:
- `references/authoring-language.md`
- `references/cli-workflows.md`

## Examples

Example requests this skill should handle well:
- "Create a shared approval diagram and include it in two docs."
- "Fix broken `mermaid-include` references."
- "Convert a repeated subprocess into a fragment with `exports`."
- "Run `mdmm check` and explain why build still fails."
- "Show which docs depend on `customer-verification.overview`."

## Response Style

- Explain MDMM-specific constraints when they affect the change.
- Prefer concrete examples over abstract descriptions.
- If a reference breaks, explain whether the issue is path resolution, missing block id, duplicate short id, missing template argument, invalid `alias`, invalid `exports`, or include-depth exhaustion.
- When changing a shared block, call out likely downstream impact and suggest `mdmm report` if that impact is unknown.
