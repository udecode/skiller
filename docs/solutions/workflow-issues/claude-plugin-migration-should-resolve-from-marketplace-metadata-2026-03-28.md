---
title: Claude plugin migration should resolve from marketplace metadata
date: 2026-03-28
category: docs/solutions/workflow-issues
module: claude plugin to skills migration
problem_type: workflow_issue
component: tooling
symptoms:
  - hard-cutting plugin sync left users with legacy Claude plugin state but no bulk migration path
  - the repo source for an enabled plugin was not always obvious from .claude/settings.json alone
  - multiple enabled plugins from one marketplace needed to collapse into a single skills install source
root_cause: missing_tooling
resolution_type: tooling_addition
severity: medium
tags: [skiller, skills, claude-plugins, migration, marketplace, tooling]
---

# Claude plugin migration should resolve from marketplace metadata

## Problem

After removing Claude plugin sync from `apply`, the migration story sucked. Users could see that legacy plugin state was unsupported, but they still had to manually figure out which repo to install through `skills`, dedupe repeated marketplace repos, and ignore stale manifest leftovers without good tooling.

## Symptoms

- `skiller apply` failed on legacy Claude plugin state with no bulk migration command
- plugin ids like `compound-engineering@every-marketplace` told you the marketplace, not the install source
- several enabled plugins from the same marketplace really mapped to one repo install, but nothing grouped them

## What Didn't Work

- Reintroducing plugin sync into `apply` would have been the same old bad idea in a new hat
- Reading only `.claude/settings.json.enabledPlugins` was not enough to derive install sources cleanly
- Guessing from plugin folder names or install paths would have been brittle and gross

## Solution

Add a one-shot migration command: `skiller migrate claude-plugins`.

The command plans repo installs from three stable inputs:

- project `.claude/settings.json`
- home `~/.claude/plugins/known_marketplaces.json`
- marketplace catalogs at `~/.claude/plugins/marketplaces/<id>/.claude-plugin/marketplace.json`

Resolution rules:

- If a plugin entry exposes an explicit external source (`github`, `git`, or `url`), use that
- Otherwise fall back to the marketplace repo source
- Deduplicate installs by resolved repo or URL, so multiple plugins from one marketplace become one `skills add`
- Include legacy plugin ids from `.agents/.skiller.json` or `.claude/.skiller.json` so stale manifests do not get missed
- Dry-run by default; require `--execute` for the actual installs

Execution uses strict `skills` parity:

```bash
skiller migrate claude-plugins --execute
```

Internally each resolved source becomes:

```bash
skills add <source> --agent universal --skill '*' -y
```

The legacy apply error now points to the migration command first, not a hand-written one-off `skiller add` example.

## Why This Works

The marketplace metadata is the stable contract Claude already maintains. `enabledPlugins` tells you what the project still depends on, `known_marketplaces.json` tells you where each marketplace came from, and each marketplace catalog tells you whether a plugin has its own external source or just lives inside the marketplace repo. That is enough to generate a deterministic migration plan without restoring plugin sync or scraping random install directories.

## Prevention

- Keep migration tooling separate from steady-state `apply`
- Resolve legacy plugin installs from marketplace metadata, not folder-name heuristics
- Deduplicate by resolved repo or URL before executing `skills add`
- Make migration commands dry-run first by default; force explicit execution

## Related Issues

- `docs/solutions/logic-errors/managed-skill-aliases-must-not-extract-to-local-rules-2026-03-28.md`
