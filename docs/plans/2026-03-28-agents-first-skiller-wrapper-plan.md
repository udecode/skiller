# Agents-First Skiller Wrapper Plan

## Goal

Make `skiller` a `.agents`-first wrapper around `skills`, with:

- `.agents/AGENTS.md` as the authored shared instruction source
- `.agents/skills` as the canonical project skills tree
- `.agents/rules` as the only local `.mdc` authoring source
- `skills-lock.json` owning upstream-installed `skills.sh` skills
- `.agents/.skiller.json` owning local/generated skiller-managed skills
- canonical `.agents/skills` staying plain `SKILL.md` only
- explicit ownership buckets: upstream, local, managed, orphan

## Slices

1. Hard-cut config/source discovery from `.claude` to `.agents`.
2. Add `skills` CLI wrapper commands to `skiller`.
3. Enforce upstream-vs-local skill ownership inside `.agents/skills`.
4. Restrict colocated `.mdc` behavior to skiller-owned local skills.
5. Make skill propagation symlink-first.
6. Add legacy `.claude` -> `.agents` migration with conflict detection.

## Guardrails

- TDD: write the failing test first for each slice.
- `skiller apply` stays offline and deterministic.
- No eject/localize flow in this pass.
- No mixed ownership for the same skill name.

## Progress

- [x] Slice 1: `.agents` config and source-tree hard cut
- [x] Slice 2: wrapper command surface around `skills`
- [x] Slice 3: ownership split inside `.agents/skills`
- [x] Slice 4: colocated `.mdc` only for skiller-owned local skills
- [x] Slice 5: symlink-first propagation
- [x] Slice 6: legacy migration

## Notes

- `copySkillsToAgent` now refuses symlinks when flattening nested skills, so renamed skills still get rewritten `name:` frontmatter.
- Canonical project skills now resolve from `.agents/skills`, with `.claude/skills` only as a legacy fallback.
- Legacy `.codex/skills` migrates into `.agents/skills` even when `.agents/skills` is already the canonical source directory.
- `migrateLegacyProjectState()` now preflights conflicts, dedupes identical legacy/canonical files, migrates legacy `rules/*.mdc` into `.agents/skills/<name>/`, then normalizes the canonical skills tree.
- `applyAllAgentConfigs()` now runs legacy project-state migration before loading config, so old `.claude` state gets moved forward automatically.
- Follow-up ownership cut: normal `apply` no longer extracts `.agents/skills/*` back into `.agents/rules/*`. Only explicit local rule sources create local skills. Canonical skills are classified from explicit metadata only: upstream (`skills-lock.json`), local (`.agents/rules/*.mdc` or `.agents/.skiller.json.localSkills`), managed (manifest target entries), or orphan (warn-only, untouched).
- Alias suppression follow-up: orphan canonical names that shadow a manifest-managed numeric-suffix family like `foo` vs `foo-2` are now left untouched and excluded from `.agents/rules` extraction, which keeps stale plugin aliases from being adopted as local rules.
