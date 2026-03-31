# Configuration (`skiller.toml`)

Skiller looks for `.agents/skiller.toml` by walking up from `--project-root`.

- If no local `.agents/skiller.toml` is found, it falls back to `$XDG_CONFIG_HOME/skiller/skiller.toml`.
- If `.agents/` exists but has no `skiller.toml`, Skiller keeps walking.

## Agent selection precedence

- `skiller apply --agents ...`
- `default_agents = [...]`
- `[agents.<id>].enabled = false` disables an agent
- Otherwise: all agents are enabled

## Rule discovery and ordering

Skiller reads `.md` and `.mdc` under `.agents/` recursively.

- Primary file: `.agents/AGENTS.md` if present
- Legacy fallback: `.agents/instructions.md` if `AGENTS.md` is missing
- Repository root `AGENTS.md` (outside `.agents/`) is prepended if it exists and does not look like a Skiller-generated blob
- Remaining files are appended in sorted path order

Filtering:

- `[rules].include` only keeps matching files
- `[rules].exclude` drops matches (wins over `include`)
- Bare directory patterns expand to `dir/**/*.{md,mdc}`

Cursor merge strategy:

- `rules.merge_strategy = "cursor"` keeps `AGENTS.md` plus Cursor-style `.mdc` rules under `rules/` and `skills/` with `alwaysApply: true`

## Schema

High level (see `docs/mcp.md` for MCP details):

- `default_agents = ["claude-code", "codex"]`
- `nested = true|false`
- `[sync] source, mode = "auto"|"preset"|"repo", clean, include, exclude`
- `[rules] include = [...], exclude = [...], merge_strategy = "all"|"cursor"`
- `[backup] enabled = true|false`
- `[gitignore] enabled = true|false`
- `[skills] enabled = true|false`
- `[mcp] enabled = true|false, merge_strategy = "merge"|"overwrite"`
- `[mcp_servers.<name>]` server definitions
- `[agents.<id>] enabled, output_path, output_path_instructions, output_path_config, gitignore`
- `[agents.<id>.mcp] enabled, merge_strategy`

## `[sync]`

`[sync]` lets `skiller install` and `skiller update` hydrate a project from a shared preset or repo source before lock restore/update and `apply`.

Use it for internal repos that intentionally inherit from another local source.
For distributable starters or templates, prefer one-shot materialization with `skiller install <source> --preset <name>` so the generated repo does not keep a live dependency on your local filesystem.

Preset installs can also reuse shared source files without duplicating them inside the preset folder:

- add `preset.toml` to the preset root
- declare `include = ["../../.agents/rules/react.mdc", "../../skills-lock.json"]`
- include entries must resolve to files, not directories
- includes resolve relative to the preset root
- target paths are derived from the first supported root marker: `.agents`, `.claude`, `.codex`, `skills-lock.json`, or `skiller-lock.json`
- files that physically exist inside the preset root still override included files with the same target path

Fields:

- `source`: required, resolved relative to the project root
- `mode`: optional, `auto` (default), `preset`, or `repo`
- `clean`: optional, defaults to `true`
- `include`: optional in preset mode, required in repo mode
- `exclude`: optional in both modes

Mode rules:

- `preset`: sync allowlisted roots by default: `.agents/**`, `.claude/**`, `.codex/**`, `skills-lock.json`, `skiller-lock.json`
- `repo`: sync only `include` matches, then apply `exclude`
- `auto`: uses preset mode when the source looks like a curated preset root; otherwise require `include` and switch to repo mode

Important:

- Source `.agents/skiller.toml` is not copied verbatim. Skiller reads it as a base config and merges the local target `.agents/skiller.toml` on top.
- Local `[sync]` always wins.
- Generated/runtime surfaces are never synced: `.agents/skills/**`, `.claude/skills/**`, `.git/**`, `node_modules/**`

## MCP servers: TOML vs JSON

- Preferred: `skiller.toml` `[mcp_servers.*]`
- Legacy: `.agents/mcp.json` is still read, but deprecated
- Merge rule: TOML wins by server name
- `${VAR}` is expanded inside `mcp_servers.<name>.env` values
