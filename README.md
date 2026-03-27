# `skiller`

Apply the same rules (and skills) to multiple AI coding agents.

```bash
npx skiller@latest init
npx skiller@latest apply
```

## Skills

- `.claude/skills/` is the committed source of truth
- On `apply`, skills are synced to the same project skill directories defined by the sibling `skills` project
- Claude Code plugins, commands, and agents are also synced as skills to other agents
- See [docs/skills.md](docs/skills.md)

## MCP

- Define MCP servers once in `skiller.toml`
- On `apply`, servers are propagated to all agents that support MCP
- See [docs/mcp.md](docs/mcp.md)

## Docs

- [docs/cli.md](docs/cli.md) — commands and flags
- [docs/config.md](docs/config.md) — `skiller.toml` reference
- [docs/skills.md](docs/skills.md) — skills, propagation, plugin sync
- [docs/mcp.md](docs/mcp.md) — MCP server config and propagation
- [docs/troubleshooting.md](docs/troubleshooting.md) — common failures and fixes
- [docs/development.md](docs/development.md) — dev workflow
- [docs/migration-from-ruler.md](docs/migration-from-ruler.md) — notes for `ruler` users

## Supported agents

| Identifier       | Agent          | Rules                                              | MCP                            | Skills              |
| ---------------- | -------------- | -------------------------------------------------- | ------------------------------ | ------------------- |
| `github-copilot` | GitHub Copilot | `AGENTS.md`                                        | `.vscode/mcp.json` (`servers`) | `.agents/skills`    |
| `claude-code`    | Claude Code    | `CLAUDE.md` (`@file` refs)                         | `.mcp.json`                    | `.claude/skills`    |
| `codex`          | Codex          | `AGENTS.md`, `.codex/config.toml`                  | `.codex/config.toml`           | `.agents/skills`    |
| `cursor`         | Cursor         | `AGENTS.md`                                        | `.cursor/mcp.json`             | `.agents/skills`    |
| `windsurf`       | Windsurf       | `AGENTS.md`                                        | `.windsurf/mcp_config.json`    | `.windsurf/skills`  |
| `cline`          | Cline          | `.clinerules`                                      | -                              | `.agents/skills`    |
| `openhands`      | OpenHands      | `.openhands/microagents/repo.md`                   | `config.toml`                  | `.openhands/skills` |
| `gemini-cli`     | Gemini CLI     | `AGENTS.md`, `.gemini/settings.json`               | `.gemini/settings.json`        | `.agents/skills`    |
| `junie`          | Junie          | `.junie/guidelines.md`                             | -                              | `.junie/skills`     |
| `augment`        | Augment        | `.augment/rules/skiller_augment_instructions.md`   | -                              | `.augment/skills`   |
| `kilo`           | Kilo Code      | `.kilocode/rules/skiller_kilocode_instructions.md` | `.kilocode/mcp.json`           | `.kilocode/skills`  |
| `opencode`       | OpenCode       | `AGENTS.md`, `opencode.json`                       | `opencode.json`                | `.agents/skills`    |
| `goose`          | Goose          | `.goosehints`                                      | -                              | `.goose/skills`     |
| `crush`          | Crush          | `CRUSH.md`, `.crush.json`                          | `.crush.json`                  | `.crush/skills`     |
| `amp`            | Amp            | `AGENTS.md`                                        | -                              | `.agents/skills`    |
| `qwen-code`      | Qwen Code      | `AGENTS.md`, `.qwen/settings.json`                 | `.qwen/settings.json`          | `.qwen/skills`      |
| `kiro-cli`       | Kiro CLI       | `.kiro/steering/skiller_kiro_instructions.md`      | -                              | `.kiro/skills`      |
| `warp`           | Warp           | `WARP.md`                                          | -                              | `.agents/skills`    |
| `roo`            | Roo Code       | `AGENTS.md`, `.roo/mcp.json`                       | `.roo/mcp.json`                | `.roo/skills`       |
| `trae`           | Trae           | `.trae/rules/project_rules.md`                     | -                              | `.trae/skills`      |
