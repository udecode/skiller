---
"skiller": minor
---

Make `.claude/skills/` the committed source of truth

- Remove skillz MCP integration (skillz directory, MCP tool registration)
- Remove `generate_from_rules` and `prune` config options from SkillsConfig
- Remove `generateSkillsFromRules()` - users edit SKILL.md directly
- Remove orphan detection (`pruneOrphanedSkills`) - skills are never deleted
- Stop gitignoring `.claude/skills/` - it's now the committed source
- Add path traversal prevention in SkillsUtils.ts
- Use explicit safe YAML schema in FrontmatterParser.ts
- Add depth limits to recursive functions
