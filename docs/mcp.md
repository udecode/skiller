# MCP (Model Context Protocol)

Skiller can propagate MCP server configs to agents that support it.

## Define MCP servers

Preferred: `skiller.toml`.

```toml
[mcp]
enabled = true
merge_strategy = "merge" # or "overwrite"

[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "."]

[mcp_servers.remote_api]
url = "https://api.example.com/mcp"

[mcp_servers.remote_api.headers]
Authorization = "Bearer ${TOKEN}"
```

Legacy: `.claude/mcp.json` is still read, but deprecated.

## Filtering + transforms

Skiller filters servers per agent capability:

- Agents that support remote servers get `url` servers as-is
- Agents that only support stdio get remote servers transformed into stdio via `mcp-remote@latest`

Agent-specific transforms:

- Claude Code: `type = "remote"` is rewritten to `http` or `sse` based on the URL
- Kilo Code: `type = "remote"` is rewritten to `streamable-http`
- Firebase Studio: `type` fields are stripped before writing `.idx/mcp.json`

## Merge vs overwrite

- `merge` (default): shallow merge by server name
- `overwrite`: replace the whole server block for that agent

You can override per agent:

```toml
[agents.cursor.mcp]
enabled = true
merge_strategy = "overwrite"
```

## Where MCP is written

- External propagation writes to the agent's native MCP file (see `docs/agents.md`)
- Some agents manage MCP in their own config format inside the adapter (also listed in `docs/agents.md`)
