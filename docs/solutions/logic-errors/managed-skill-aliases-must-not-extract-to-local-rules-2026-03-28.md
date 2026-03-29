---
title: Managed skill aliases must not extract to local rules
date: 2026-03-28
category: docs/solutions/logic-errors
module: skill ownership and rule extraction
problem_type: logic_error
component: tooling
symptoms:
  - skiller apply recreated .agents/rules/compound-engineering-agent-browser.mdc from a canonical skill folder
  - plugin-managed skills with numeric suffixes left unsuffixed stale aliases behind in .agents/skills
  - orphan extraction adopted stale plugin aliases into .agents/.skiller.json localSkills
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [skiller, skills, ownership, plugins, aliases, mdc]
---

# Managed skill aliases must not extract to local rules

## Problem

`skiller apply` was treating stale canonical aliases like `compound-engineering-agent-browser` as user-owned local skills even when the real plugin-managed destination was `compound-engineering-agent-browser-2`. That polluted `.agents/rules`, adopted the alias into local ownership, and blurred the boundary between managed plugin output and actual local authoring.

## Symptoms

- `skiller apply` generated `.agents/rules/compound-engineering-agent-browser.mdc`
- canonical plugin duplicates like `foo` and `foo-2` coexisted, but only the suffixed one was in manifest target entries
- extraction logic only skipped exact managed names, so unsuffixed stale aliases slipped through

## What Didn't Work

- Exact-name ownership checks were too narrow. They correctly skipped `compound-engineering-agent-browser-2` but still extracted `compound-engineering-agent-browser`.
- File-diff or content-based ownership detection would have been a bad fix. Formatting-only changes from linters or editors would make ownership classification flaky.

## Solution

Treat numeric-suffix managed destinations as explicit alias families and suppress extraction of the unsuffixed base name.

`src/core/SkillOwnership.ts` now derives two manifest-backed sets:

```ts
const managedInfo = await readManagedSkillInfo(projectRoot);
const managedOwned = managedInfo.names;
const managedAliasBases = managedInfo.aliasBases;
```

Alias bases come from managed destinations like `foo-2`, which produce a protected base alias `foo`.

`src/core/SkillsProcessor.ts` now skips extraction for those protected bases:

```ts
if (ownership.managedOwned.has(skillName)) {
  continue;
}
if (ownership.managedAliasBases.has(skillName)) {
  continue;
}
```

The regression is pinned in `tests/skills-propagation.test.ts` with the real shape that broke:

- canonical `compound-engineering-agent-browser`
- managed manifest entry for `compound-engineering-agent-browser-2`

## Why This Works

The fix stays grounded in explicit metadata instead of heuristics. Manifest target entries already declare which names skiller manages. Deriving alias families from suffixed managed destinations lets skiller recognize stale duplicates created by prior collision handling without reading file contents, comparing hashes, or guessing from timestamps.

## Prevention

- When ownership decisions matter, derive them from `skills-lock.json` and manifest entries, not file content or formatting.
- Keep regression tests around real duplicate-name shapes, not toy names only.
- If sync code creates collision suffixes like `-2`, treat the unsuffixed base as reserved unless there is an explicit local rule claiming it.

## Related Issues

- None recorded.
