# Configuration (`skiller.toml`)

Skiller looks for `.claude/skiller.toml` by walking up from `--project-root`.

- If no local `.claude/skiller.toml` is found, it falls back to `$XDG_CONFIG_HOME/skiller/skiller.toml`.
- If `.claude/` exists but has no `skiller.toml`, Skiller keeps walking.

## Agent selection precedence

- `skiller apply --agents ...`
- `default_agents = [...]`
- `[agents.<id>].enabled = false` disables an agent
- Otherwise: all agents are enabled

## Rule discovery and ordering

Skiller reads `.md` and `.mdc` under `.claude/` recursively.

- Primary file: `.claude/AGENTS.md` if present
- Legacy fallback: `.claude/instructions.md` if `AGENTS.md` is missing
- Repository root `AGENTS.md` (outside `.claude/`) is prepended if it exists and does not look like a Skiller-generated blob
- Remaining files are appended in sorted path order

Filtering:

- `[rules].include` only keeps matching files
- `[rules].exclude` drops matches (wins over `include`)
- Bare directory patterns expand to `dir/**/*.{md,mdc}`

Cursor merge strategy:

- `rules.merge_strategy = "cursor"` keeps `AGENTS.md` plus Cursor-style `.mdc` rules under `rules/` and `skills/` with `alwaysApply: true`

## Schema

High level (see `docs/mcp.md` for MCP details):

- `default_agents = ["claude", "codex"]`
- `nested = true|false`
- `[rules] include = [...], exclude = [...], merge_strategy = "all"|"cursor"`
- `[backup] enabled = true|false`
- `[gitignore] enabled = true|false`
- `[skills] enabled = true|false`
- `[mcp] enabled = true|false, merge_strategy = "merge"|"overwrite"`
- `[mcp_servers.<name>]` server definitions
- `[agents.<id>] enabled, output_path, output_path_instructions, output_path_config, gitignore`
- `[agents.<id>.mcp] enabled, merge_strategy`

## MCP servers: TOML vs JSON

- Preferred: `skiller.toml` `[mcp_servers.*]`
- Legacy: `.claude/mcp.json` is still read, but deprecated
- Merge rule: TOML wins by server name
- `${VAR}` is expanded inside `mcp_servers.<name>.env` values
