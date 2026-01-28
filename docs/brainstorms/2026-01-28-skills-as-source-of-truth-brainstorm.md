---
date: 2026-01-28
topic: skills-as-source-of-truth
---

# Skills as Source of Truth

## What We're Building

Refactor skiller to make `.claude/skills/` the committed source of truth, eliminating the intermediate `.claude/rules/` → skills generation pipeline.

**New structure:**
```
.claude/skills/
  api/
    SKILL.md         # Auto-generated wrapper (user never edits)
  api.mdc            # User-editable source (frontmatter + content)
```

**Key changes:**
- `.claude/skills/` is committed (removed from gitignore)
- Drop `generate_from_rules` config option
- Drop `prune` config option
- Drop skillz MCP support entirely
- Auto-migrate `.claude/rules/` to new structure (then delete rules folder)

## Why This Approach

The current architecture has unnecessary complexity:
1. `.mdc` files in `.claude/rules/` generate skills in `.claude/skills/`
2. Skills are gitignored (regenerated on apply)
3. Skillz MCP provides skills to non-native agents

This creates a confusing indirection. By making `.claude/skills/` the source of truth:
- Users edit `.mdc` files directly in skills folder
- SKILL.md is auto-generated for Claude Code discovery
- No more generation/pruning/orphan detection complexity
- Skillz MCP removal simplifies codebase significantly

## Key Decisions

### File Structure
- **SKILL.md**: Auto-generated thin wrapper containing:
  - Frontmatter: `name`, `description`
  - Body: `@.claude/skills/{name}.mdc` reference
- **{name}.mdc**: User-editable source containing:
  - Frontmatter: `description`, `globs`, `alwaysApply`
  - Body: Actual skill content

### Sync Behavior (Two-Pass with Marker)

Skiller adds `synced: true` to SKILL.md frontmatter when it syncs.

**Detection logic:**
1. If `SKILL.md` has NO `synced: true` → external install (e.g., from agentskills.io)
   - Sync direction: `SKILL.md` → `.mdc`
   - Extract body to sibling `.mdc`, add `synced: true` to SKILL.md
2. If `SKILL.md` HAS `synced: true` → skiller-managed
   - Sync direction: `.mdc` → `SKILL.md`
   - Regenerate SKILL.md from `.mdc` content

This handles:
- Fresh installs from skill registries (SKILL.md has body content, no marker)
- Reinstalls of the same skill (marker present, use local .mdc as source)
- Normal skiller workflow (edit .mdc, apply regenerates SKILL.md)

### Migration
- If `.claude/rules/` exists on apply:
  1. Migrate each `.mdc` file to `.claude/skills/{name}/SKILL.md` + sibling `.mdc`
  2. Delete `.claude/rules/` folder after successful migration

### Removed Features
- `generate_from_rules` config option (always migrate if rules exist)
- `prune` config option (no orphan concept anymore)
- Skillz MCP server support (full code removal)
- `.skillz/` directory handling

### Gitignore Changes
- Remove `.claude/skills/` from auto-added gitignore entries
- Keep `.skillz/` removal (won't exist anymore)

## Open Questions

None - requirements are clear.

## Next Steps

→ `/workflows:plan` for implementation details
