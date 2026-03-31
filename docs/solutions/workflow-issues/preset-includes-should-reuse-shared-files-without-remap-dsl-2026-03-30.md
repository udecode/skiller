---
title: Preset includes should reuse shared files without a remap DSL
date: 2026-03-30
category: docs/solutions/workflow-issues
module: preset installs
problem_type: workflow_issue
component: tooling
symptoms:
  - distributable presets duplicated `.agents` files that also existed in the source repo
  - shared rules like `react.mdc` drifted because the preset became a second hand-edited source tree
  - fixing the duplication risked overcorrecting into a complicated source-root or path-remap feature
root_cause: missing_tooling
resolution_type: code_fix
severity: medium
tags: [skiller, preset, include, lockfiles, templates]
---

# Preset includes should reuse shared files without a remap DSL

## Problem

Preset installs were too blunt. They copied whatever lived inside the preset directory, which meant shared files had to be duplicated there if a source repo also needed them. That works until it doesn’t, then you get two “sources of truth” and one of them is lying.

## Symptoms

- preset authoring turned into manual copy babysitting
- shared files like `.agents/rules/react.mdc` could diverge between repo root and preset
- trying to fix it invited bad ideas like `source_root`, arbitrary `from -> to` remaps, or repo-specific build glue

## What Didn't Work

- keeping a fully bundled preset directory as the only model just preserved the duplication
- adding a real remap DSL would have solved the wrong problem with more machinery than the use case deserved
- requiring a separate source-root setting just to share a few files was needless ceremony

## Solution

Teach `PresetInstaller` to read an optional `preset.toml` with a simple `include` list.

- include paths resolve relative to the preset root
- include entries must resolve to files, not directories
- included files are copied first
- files physically present inside the preset still override included files with the same target path
- target paths are derived from the first supported root marker instead of a manual mapping table:
  - `.agents`
  - `.claude`
  - `.codex`
  - `skills-lock.json`
  - `skiller-lock.json`
- `.agents/skiller.toml` stays special: it is merged into the local final config instead of copied raw

That keeps preset authoring simple while still letting a repo share root rules and lockfiles with its templates.

## Why This Works

The preset feature only needed one missing capability: “reuse this exact shared file.” It did not need a miniature build system.

Deriving the destination from supported root markers keeps the feature narrow and predictable. The preset author says where to pull from, not how to rewrite paths across the whole repo. That is enough for shared rules and lockfiles, and it keeps install behavior understandable.

## Prevention

- if a preset needs a shared repo file, prefer `preset.toml` includes before duplicating it into the preset
- do not add arbitrary path remapping unless a real case appears that same-path installs cannot handle
- keep lockfile reuse boring: include `skills-lock.json` or `skiller-lock.json`, then let the normal install lifecycle restore skills
- pin the behavior with integration tests that cover:
  - include + local override
  - lockfile-driven skill install after preset materialization
  - legacy presets with no `preset.toml`

## Related Issues

- `docs/solutions/workflow-issues/github-blob-agent-sources-should-install-one-skill-2026-03-30.md`
