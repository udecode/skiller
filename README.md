# `skiller`

Apply the same rules (and skills) to multiple AI coding agents.

```bash
npx skiller@latest init
npx skiller@latest apply
```

## Skills

- `.claude/skills/` is the committed source of truth
- On `apply`, skills are synced to all agents' native skill directories
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

| Identifier    | Agent             | Rules                                                    | MCP                            | Skills            |
| ------------- | ----------------- | -------------------------------------------------------- | ------------------------------ | ----------------- |
| `agentsmd`    | AgentsMd (pseudo) | `AGENTS.md`                                              | -                              | -                 |
| `copilot`     | GitHub Copilot    | `AGENTS.md`                                              | `.vscode/mcp.json` (`servers`) | `.claude/skills`  |
| `claude`      | Claude Code       | `CLAUDE.md` (`@file` refs)                               | `.mcp.json`                    | `.claude/skills`  |
| `codex`       | OpenAI Codex CLI  | `AGENTS.md`, `.codex/config.toml`                        | `.codex/config.toml`           | `.codex/skills`   |
| `cursor`      | Cursor            | `AGENTS.md`                                              | `.cursor/mcp.json`             | `.cursor/skills`  |
| `windsurf`    | Windsurf          | `AGENTS.md`                                              | `.windsurf/mcp_config.json`    | -                 |
| `cline`       | Cline             | `.clinerules`                                            | -                              | -                 |
| `aider`       | Aider             | `AGENTS.md`, `.aider.conf.yml`                           | `.mcp.json`                    | -                 |
| `firebase`    | Firebase Studio   | `.idx/airules.md`                                        | `.idx/mcp.json`                | -                 |
| `openhands`   | Open Hands        | `.openhands/microagents/repo.md`                         | `config.toml`                  | -                 |
| `gemini-cli`  | Gemini CLI        | `AGENTS.md`, `.gemini/settings.json`                     | `.gemini/settings.json`        | `.gemini/skills`  |
| `jules`       | Jules             | `AGENTS.md`                                              | -                              | -                 |
| `junie`       | Junie             | `.junie/guidelines.md`                                   | -                              | -                 |
| `augmentcode` | AugmentCode       | `.augment/rules/skiller_augment_instructions.md`         | -                              | -                 |
| `kilocode`    | Kilo Code         | `.kilocode/rules/skiller_kilocode_instructions.md`       | `.kilocode/mcp.json`           | `.claude/skills`  |
| `opencode`    | OpenCode          | `AGENTS.md`, `opencode.json`                             | `opencode.json`                | `.opencode/skill` |
| `goose`       | Goose             | `.goosehints`                                            | -                              | `.agents/skills`  |
| `crush`       | Crush             | `CRUSH.md`, `.crush.json`                                | `.crush.json`                  | -                 |
| `amp`         | Amp               | `AGENTS.md`                                              | -                              | `.agents/skills`  |
| `zed`         | Zed               | `AGENTS.md`, `.zed/settings.json`                        | `.zed/settings.json`           | -                 |
| `qwen`        | Qwen Code         | `AGENTS.md`, `.qwen/settings.json`                       | `.qwen/settings.json`          | -                 |
| `kiro`        | Kiro              | `.kiro/steering/skiller_kiro_instructions.md`            | -                              | -                 |
| `warp`        | Warp              | `WARP.md`                                                | -                              | -                 |
| `roo`         | RooCode           | `AGENTS.md`, `.roo/mcp.json`                             | `.roo/mcp.json`                | `.roo/skills`     |
| `trae`        | Trae AI           | `.trae/rules/project_rules.md`                           | -                              | -                 |
| `amazonqcli`  | Amazon Q CLI      | `.amazonq/rules/skiller_q_rules.md`, `.amazonq/mcp.json` | `.amazonq/mcp.json`            | -                 |
| `firebender`  | Firebender        | `firebender.json`                                        | `firebender.json`              | -                 |
