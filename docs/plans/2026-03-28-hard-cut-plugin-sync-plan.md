# Hard-Cut Plugin Sync Plan

## Goal

Make `skiller` strictly `skills`-centric by removing Claude plugin syncing from `apply` and failing fast on legacy plugin-backed state.

## Steps

1. Add failing tests for legacy plugin rejection:
   - enabled Claude plugins in `.claude/settings.json`
   - plugin manifest entries in `.agents/.skiller.json` / legacy `.claude/.skiller.json`
2. Remove steady-state plugin sync from `apply`.
3. Add a legacy plugin detector with an explicit migration error.
4. Remove plugin ownership from steady-state skill ownership logic.
5. Rewrite or remove plugin-sync tests so the suite matches the new model.
6. Verify focused suites, typecheck, lint, and a real `apply` failure on this repo until the plugin is removed from `.claude/settings.json`.

## Notes

- Keep `skiller add/remove/list/find/check/update` as thin wrappers around `skills`.
- Do not add special support for `https://skills.sh/...` URLs.
- Keep repo-owned `.claude/commands` and `.claude/agents` syncing via `ClaudeProjectSync`.
