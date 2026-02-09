# Supported agents

This is the list in `src/agents/index.ts`.

Columns:

- Rules: instruction file(s) written by `skiller apply`
- MCP: native MCP config file updated (if supported)
- Skills: native skills directory (if supported)

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

Notes:

- Some agents handle MCP inside their adapter (Codex CLI, Gemini CLI, OpenCode, Crush, Zed, RooCode, Firebender, Amazon Q CLI)
- Some agents use `AGENTS.md` but do not have native MCP or skills support
