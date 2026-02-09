# CLI

Skiller is a Node CLI (Node >= 18).

## Install / run

- One-off: `npx skiller@latest apply`
- Global: `npm i -g skiller` then `skiller apply`

## `skiller init`

Scaffolds a `.claude/` folder.

- Creates `.claude/AGENTS.md`
- Creates `.claude/skiller.toml`
- `skiller init --global` writes to `$XDG_CONFIG_HOME/skiller` (default `~/.config/skiller`)

## `skiller apply`

Reads rules, selects agents, writes agent-specific files, then optionally syncs MCP, skills, and `.gitignore`.

Flags:

- `--project-root <path>`: project root (default: cwd)
- `--agents <csv>`: identifiers or name substrings (case-insensitive)
- `--config <path>`: TOML config path (default: `.claude/skiller.toml` or global)
- `--mcp` / `--no-mcp`: enable/disable MCP propagation (default: enabled)
- `--mcp-overwrite`: overwrite native MCP config instead of merging
- `--gitignore` / `--no-gitignore`: enable/disable `.gitignore` updates (default: enabled)
- `--backup` / `--no-backup`: enable/disable `.bak` backups (default: enabled)
- `--skills` / `--no-skills`: enable/disable skills (default: enabled)
- `--nested` / `--no-nested`: enable nested `.claude/` discovery (default: from TOML, otherwise off)
- `--local-only`: ignore global config
- `--dry-run`: show what would change, write nothing
- `--verbose` / `-v`: more logs

## `skiller revert`

Restores files from `.bak` when present, otherwise removes generated files.

Flags:

- `--project-root <path>`: project root (default: cwd)
- `--agents <csv>`: revert only some agents
- `--config <path>`: TOML config path
- `--keep-backups`: keep `.bak` after restoring
- `--local-only`: ignore global config
- `--dry-run`: show what would change, write nothing
- `--verbose` / `-v`: more logs
