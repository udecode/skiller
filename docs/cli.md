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

- `skiller install <source> --preset <name>`: materialize a preset from a local path or GitHub source, restore native + agent-derived lock-backed skills, prune stale lock entries, then run `skiller apply`
- `skiller install`: run `[sync]` first when configured, restore native + agent-derived lock-backed skills, prune stale lock entries, then run `skiller apply`
- `skiller update`: run `[sync]` first when configured, refresh native + agent-derived lock-backed skills, prune stale lock entries, then run `skiller apply`
- `skiller outdated`: show available upstream updates without applying anything
- `skiller apply`: pure local sync/compile/propagation, no network access

## `skiller apply`

Reads rules, selects agents, writes agent-specific files, then optionally syncs MCP, skills, and `.gitignore`.

Flags:

- `--project-root <path>`: project root (default: cwd)
- `--agents <csv>`: identifiers or name substrings (case-insensitive)
- `--config <path>`: TOML config path (default: `.agents/skiller.toml` or global)
- `--mcp` / `--no-mcp`: enable/disable MCP propagation (default: enabled)
- `--mcp-overwrite`: overwrite native MCP config instead of merging
- `--gitignore` / `--no-gitignore`: enable/disable `.gitignore` updates (default: enabled)
- `--backup` / `--no-backup`: enable/disable `.bak` backups (default: enabled)
- `--skills` / `--no-skills`: enable/disable skills (default: enabled)
- `--nested` / `--no-nested`: enable nested `.agents/` discovery (default: from TOML, otherwise off)
- `--local-only`: ignore global config
- `--dry-run`: show what would change, write nothing
- `--verbose` / `-v`: more logs

## `skiller install`

Runs one of two paths:

- `skiller install <source> --preset <name>`: materialize a preset from a local path, GitHub repo shorthand, or GitHub URL into the current project, write the merged final `.agents/skiller.toml`, then restore lock-backed skills and run `apply`
- `skiller install`: run `[sync]` first when configured, then restore native lock-backed skills via the local `skills experimental_install` flow, restore skiller-managed agent installs from `skiller-lock.json`, prune stale lock-backed outputs, then run `skiller apply`

Flags:

- `--project-root <path>`: project root (default: cwd)
- `[source]`: optional preset source for one-shot materialization, for example `../dotai`, `owner/repo`, or `https://github.com/owner/repo`
- `--preset <name>`: preset name to materialize from the source; when omitted, Skiller auto-selects a single preset or `default` when possible
- `--nested`: run the full install lifecycle for every nested `.agents` project root
- `--no-sync`: skip `[sync]` processing before install
- `--sync-only`: run preset materialization or `[sync]` only, then stop before install/apply
- `--verbose` / `-v`: more logs for the follow-up `apply`
- any trailing args are passed through to `skills experimental_install`

Preset authoring:

- A preset may include `preset.toml` at the preset root.
- `preset.toml` can declare `include = ["../../.agents/rules/react.mdc", "../../skills-lock.json"]`.
- Include entries must resolve to files, not directories.
- Included files are resolved relative to the preset root.
- Skiller derives the target path from the first supported root marker: `.agents`, `.claude`, `.codex`, `skills-lock.json`, or `skiller-lock.json`.
- Files physically present inside the preset root still win over included files with the same target path.

## `skiller update`

Runs `[sync]` first when configured, then updates native lock-backed skills via the local `skills update` flow, updates skiller-managed agent installs from `skiller-lock.json`, prunes stale lock-backed outputs, then runs `skiller apply`.

Flags:

- `--project-root <path>`: project root (default: cwd)
- `--nested`: run the full update lifecycle for every nested `.agents` project root
- `--no-sync`: skip `[sync]` processing before update
- `--sync-only`: run `[sync]` only, then stop before update/apply
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
