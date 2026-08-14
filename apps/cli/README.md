# `@mesh/cli`

Personal **Mesh** CLI — a local MCP policy gateway you run on your machine.

Clients (Cursor, Claude Code, and other MCP hosts) connect to Mesh. Mesh authenticates upstream servers, applies per-tool allow/deny policy, and proxies allowed tool calls.

## Requirements

- Node.js **20+** (Web Crypto / `globalThis.crypto` required)

## Install

```bash
npm install -g @mesh/cli
# or
npx @mesh/cli <command>
```

The binary name is `mesh`.

> The package is prepared for public npm publish (`publishConfig.access: public`). Publishing requires ownership of the `@mesh` npm org.

## Quick start

```bash
mesh init
mesh catalog
mesh add linear --connect
mesh serve
```

Point your MCP client at the local gateway:

```json
{
  "mcpServers": {
    "mesh": {
      "url": "http://127.0.0.1:8081/mcp"
    }
  }
}
```

`mesh serve` prints this snippet on startup.

## Commands

| Command | Purpose |
| --- | --- |
| `mesh init` | Create `~/.mesh` config, master key, and secrets store |
| `mesh catalog` | List built-in connector presets (`linear`, `gmail`, …) |
| `mesh add <name-or-key>` | Register an upstream MCP server (API key, pasted OAuth, or `--connect`) |
| `mesh connect <name>` | Re-run browser OAuth for an existing server |
| `mesh list` | Show configured servers (no secret values) |
| `mesh tools` | List / enable / disable upstream tools |
| `mesh serve` | Start the local MCP gateway (default `http://127.0.0.1:8081`) |

Use `mesh <command> --help` for flags. Most commands accept `--dir` to use a config directory other than `~/.mesh`.

### Examples

```bash
# Catalog preset + browser OAuth
mesh add gmail --connect

# Custom upstream with an API key
mesh add my-server --url https://mcp.example.com/mcp --auth api_key --api-key "$TOKEN"

# Inspect and toggle tools
mesh tools list linear
mesh tools disable linear some_tool_name
mesh tools enable linear some_tool_name
```

## Config layout

Default root: `~/.mesh` (override with `--dir`).

| Path | Role |
| --- | --- |
| `config.yaml` | Port + upstream server list / tool policy |
| `master.key` | Local AES-GCM master key (mode `0600`) |
| `secrets.json` | Encrypted upstream credentials (mode `0600`) |

`mesh init --force` overwrites an existing config and master key.

## Security notes

- Secrets are encrypted at rest with the local master key (`@mesh/crypto`).
- Config and secret files are written with mode `0600`.
- The gateway listens on `127.0.0.1` by default — it is meant for local clients, not exposure to the network.
- Treat `~/.mesh/master.key` like a password backup; losing it makes stored secrets unrecoverable.

## Development (monorepo)

From the repo root:

```bash
pnpm install
pnpm --filter @mesh/cli dev      # tsx watch
pnpm --filter @mesh/cli build    # tsup → dist/
pnpm --filter @mesh/cli typecheck
```

Workspace packages `@mesh/crypto` and `@mesh/shared` are **bundled into `dist`** at build time so the published package does not depend on private workspace packages.

## License

MIT
