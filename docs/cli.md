# CLI

Skiller is a Node CLI (Node >= 18).

## Install / run

- One-off: `npx skiller@latest install`
- Global: `npm i -g skiller` then `skiller install`

## `skiller init`

Scaffolds a `.agents/` folder.

- Creates `.agents/AGENTS.md`
- Creates `.agents/skiller.toml`
- `skiller init --global` writes to `$XDG_CONFIG_HOME/skiller` (default `~/.config/skiller`)

## Lifecycle

- `skiller install`: install exactly what `skills-lock.json` pins, then run `skiller apply`
- `skiller update`: refresh upstream skill versions, rewrite `skills-lock.json`, then run `skiller apply`
- `skiller outdated`: show available upstream updates without applying anything
- `skiller apply`: pure local sync/compile/propagation, no network access

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

## `skiller install`

Runs the local `skills install` command, then runs `skiller apply`.

Flags:

- `--project-root <path>`: project root (default: cwd)
- `--verbose` / `-v`: more logs for the follow-up `apply`
- any trailing args are passed through to `skills install`

## `skiller update`

Runs the local `skills update` command, then runs `skiller apply`.

Flags:

- `--project-root <path>`: project root (default: cwd)
- `--verbose` / `-v`: more logs for the follow-up `apply`
- any trailing args are passed through to `skills update`

## `skiller outdated`

Runs the local `skills outdated` command.

Flags:

- `--project-root <path>`: project root (default: cwd)
- any trailing args are passed through to `skills outdated`

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
