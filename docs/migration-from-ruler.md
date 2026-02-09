# Coming from `ruler`

Skiller is a fork of `intellectronica/ruler`.

What changed:

- Root folder is `.claude/` (not `.ruler/`)
- Claude Code gets `CLAUDE.md` as `@file` references, not a concatenated blob
- Skills are first-class: `.claude/skills/` is the committed source of truth
- Claude plugins, commands, and agents can be synced into other agents' skills dirs on `skiller apply`
