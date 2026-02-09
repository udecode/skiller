# Troubleshooting

## "No .claude directories found" / ".claude directory not found"

- Run `skiller init` at your project root
- Ensure `.claude/skiller.toml` exists (Skiller only treats a `.claude/` as active if it has `skiller.toml`)

## "Invalid configuration file format"

Common causes:

- Using `defaultAgents` instead of `default_agents`
- Typos in `merge_strategy` values (`merge`/`overwrite` for MCP, `all`/`cursor` for rules)

## Skills not showing up in other agents

- Ensure skills live under `.claude/skills/<name>/SKILL.md`
- Run `skiller apply` (skills sync happens during apply)
- Check warnings for missing `SKILL.md` (those folders are skipped)

## Claude plugins not syncing

- Ensure `.claude/settings.json` exists and has `enabledPlugins`
- Plugins are read from `~/.claude/plugins/marketplaces/...`
- If Skiller warns "Enabled plugin not installed", install the plugin in Claude Code first

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
