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

## Supported agents

- Claude Code, OpenAI Codex CLI, Cursor, GitHub Copilot, Aider, Gemini CLI, Kilo Code, OpenCode, RooCode, Goose, Amp, and [many more](docs/agents.md)

## Docs

- [docs/cli.md](docs/cli.md) — commands and flags
- [docs/config.md](docs/config.md) — `skiller.toml` reference
- [docs/skills.md](docs/skills.md) — skills, propagation, plugin sync
- [docs/agents.md](docs/agents.md) — supported agents and paths
- [docs/mcp.md](docs/mcp.md) — MCP server config and propagation
- [docs/troubleshooting.md](docs/troubleshooting.md) — common failures and fixes
- [docs/development.md](docs/development.md) — dev workflow
- [docs/migration-from-ruler.md](docs/migration-from-ruler.md) — notes for `ruler` users
