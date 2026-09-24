# Coming from `ruler`

Skiller is a fork of `intellectronica/ruler`.

What changed:

- Write shared instructions in the repository root `AGENTS.md`; Skiller reads but never rewrites it
- Keep Skiller configuration in `.agents/skiller.toml`
- Keep canonical project skills in `.agents/skills/`; Skiller projects them to `.claude/skills/` for Claude Code
- Keep Claude-specific settings, hooks, commands, and subagents under `.claude/`
