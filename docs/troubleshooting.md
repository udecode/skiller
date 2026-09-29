# Troubleshooting

## "No .agents directories found" / ".agents directory not found"

- Run `skiller init` at your project root
- Ensure `.agents/skiller.toml` exists (Skiller only treats a `.agents/` folder as active if it has `skiller.toml`)
- Ensure shared instructions are in root `AGENTS.md`; `.agents/AGENTS.md` is not read

## "Invalid configuration file format"

Common causes:

- Using `defaultAgents` instead of `default_agents`
- Typos in `merge_strategy` values (`merge`/`overwrite` for MCP, `all`/`cursor` for rules)

## Skills not showing up in other agents

- Ensure the canonical skill exists under `.agents/skills/<name>/SKILL.md`
- Run `skiller apply` (agent-specific skill mirrors are written during apply)
- Check warnings for missing `SKILL.md` (those folders are skipped)

## Claude plugins

- Skiller no longer syncs Claude plugins into skills
- `enabledPlugins` and `extraKnownMarketplaces` in `.claude/settings.json` are native Claude Code config; `skiller apply` leaves them as they are
- `skiller apply` refuses only when skiller's own manifest (`.agents/.skiller.json` or `.claude/.skiller.json`) still lists plugin entries; run `skiller migrate claude-plugins` to move those to repo installs

## I don't want Skiller touching `.gitignore`

- Run `skiller apply --no-gitignore`
- Or set `[gitignore].enabled = false` in `skiller.toml`

## I don't want `.bak` files

- Run `skiller apply --no-backup`
- Or set `[backup].enabled = false` in `skiller.toml`

## `npm install` runs `skiller apply`

This repo's `postinstall` script runs `npx skiller@latest apply` unless `$CI` is set.

- If you don't want that in your fork, delete the `postinstall` script
- If you only want to skip it in CI, set `CI=1`
