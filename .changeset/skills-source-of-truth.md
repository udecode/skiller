---
'skiller': minor
---

Make `.claude/skills/` the committed source of truth with bidirectional sync

**Bidirectional .mdc ↔ SKILL.md sync:**

- Create `.claude/skills/foo.mdc` → auto-generates `.claude/skills/foo/SKILL.md`
- Create `.claude/skills/foo/SKILL.md` → auto-generates `.claude/skills/foo.mdc`
- Uses `synced: true` frontmatter to track sync direction
- Edit either file, the other stays in sync

**Simplifications:**

- Remove skillz MCP integration (skillz directory, MCP tool registration)
- Remove `generate_from_rules` and `prune` config options (deprecated warnings added)
- Remove `generateSkillsFromRules()` and orphan detection
- Stop gitignoring `.claude/skills/` - it's now the committed source

- Add path traversal prevention in SkillsUtils.ts
- Use explicit safe YAML schema in FrontmatterParser.ts
- Add depth limits to recursive functions
