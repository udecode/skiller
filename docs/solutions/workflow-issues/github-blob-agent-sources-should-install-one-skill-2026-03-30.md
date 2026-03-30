---
title: GitHub blob agent sources should install one skill
date: 2026-03-30
category: docs/solutions/workflow-issues
module: agent source compatibility installs
problem_type: workflow_issue
component: tooling
symptoms:
  - passing a GitHub blob URL for a single agent file did not target that file
  - skiller treated blob URLs like plain repo URLs and scanned the whole repo tree
  - direct markdown file sources were not a first-class install target
root_cause: missing_tooling
resolution_type: code_fix
severity: medium
tags: [skiller, agents, github, blob, install, skiller-lock]
---

# GitHub blob agent sources should install one skill

## Problem

`skiller add <github blob url>` looked precise, but the parser was too dumb to respect it. A URL that clearly pointed at `.../agents/research/learnings-researcher.md` still got treated like `EveryInc/compound-engineering-plugin`, which meant “scan the repo and hope filters save you.” That is not install behavior. That is gambling.

## Symptoms

- a blob URL could silently fan out into many discovered agent candidates
- users had to add `--skill <name>` just to force the obvious single-file behavior
- local direct file paths to agent markdown were also second-class and did not install cleanly

## What Didn't Work

- relying on repo-wide discovery and telling users to pass `--skill` was a lousy fallback
- storing only the repo source in `skiller-lock.json` lost the user’s actual intent: one file
- treating file inputs like directories made local direct-file installs behave inconsistently

## Solution

Teach the compatibility layer to understand file-scoped sources.

`src/core/AgentSourceCompatibility.ts` now:

- parses GitHub `blob/<ref>/<path>.md` URLs into repo metadata plus an exact file subpath
- supports direct markdown file inputs as compatible local sources
- keeps repo root and selected file path separate, so discovery can compile one file while still recording the correct relative path in `skiller-lock.json`

The regression is pinned with:

- `tests/unit/core/AgentSourceCompatibility.test.ts`
- existing install/update coverage in `tests/integration/agent-source-compatibility.test.ts`

## Why This Works

The user’s source string already contains the necessary truth. A blob URL names a repo, a ref, and a file path. Once skiller preserves that structure instead of collapsing it to “repo only,” install, restore, and update all become deterministic. The lock entry records the exact source file, and discovery compiles exactly that file.

## Prevention

- treat file-scoped install inputs as first-class sources, not weird repo aliases
- keep repo root and selected file path separate in compatibility code
- test both parser behavior and real file-scoped discovery
- if a source string points at one markdown file, install one skill. Anything else is broken

## Related Issues

- `docs/solutions/workflow-issues/claude-plugin-migration-should-resolve-from-marketplace-metadata-2026-03-28.md`
