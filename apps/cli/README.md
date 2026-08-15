# `@jackline/cli`

Personal **Jackline** CLI — a local MCP policy gateway you run on your machine.

Clients (Cursor, Claude Code, and other MCP hosts) connect to Jackline. Jackline authenticates the caller with a local gateway bearer token, applies per-tool allow/deny policy, and proxies allowed tool calls to upstream MCP servers.

## Requirements

- Node.js **22+** (Web Crypto / `globalThis.crypto` required)

## Install

```bash
npm install -g @jackline/cli
# or
npx @jackline/cli <command>
```

The binary name is `jackline`.

> The package is prepared for public npm publish (`publishConfig.access: public`). Publishing requires ownership of the `@jackline` npm org.

## Quick start

```bash
jackline init
jackline catalog
jackline add linear --connect
jackline serve
```

`jackline init` / first `jackline serve` mints a **long-lived** local gateway token (`jkl_…`). Put the same bearer in every MCP client:

```json
{
  "mcpServers": {
    "jackline": {
      "url": "http://127.0.0.1:8081/mcp",
      "headers": {
        "Authorization": "Bearer jkl_<secretId>.<secret>"
      }
    }
  }
}
```

`jackline serve` prints this snippet on startup. Re-print anytime with `jackline auth show`.

## Commands

| Command | Purpose |
| --- | --- |
| `jackline init` | Create `~/.jackline` config, master key (keychain by default), secrets store, and gateway token |
| `jackline init --file-key` | Same, but store the master key as a plaintext file (warns; less secure) |
| `jackline auth show` | Print the gateway bearer token and MCP client snippet |
| `jackline catalog` | List built-in connector presets (`linear`, `gmail`, …) |
| `jackline add <name-or-key>` | Register an upstream MCP server (API key, pasted OAuth, or `--connect`) |
| `jackline connect <name>` | Re-run browser OAuth for an existing server |
| `jackline list` | Show configured servers (no secret values) |
| `jackline tools` | List / enable / disable upstream tools |
| `jackline serve` | Start the local MCP gateway (default `http://127.0.0.1:8081`) |

Use `jackline <command> --help` for flags. Most commands accept `--dir` to use a config directory other than `~/.jackline`.

### Examples

```bash
# Catalog preset + browser OAuth
jackline add gmail --connect

# Custom upstream with an API key
jackline add my-server --url https://mcp.example.com/mcp --auth api_key --api-key "$TOKEN"

# Inspect and toggle tools
jackline tools list linear
jackline tools disable linear some_tool_name
jackline tools enable linear some_tool_name

# Re-print gateway token for Cursor / Claude
jackline auth show
```

## Config layout

Default root: `~/.jackline` (override with `--dir`).

| Path / store | Role |
| --- | --- |
| `config.yaml` | Port, `keyStorage`, `gatewayTokenSecretId`, upstream servers / tool policy |
| OS keychain (default) | AES-GCM **master key** (`jackline-cli` service) |
| `master.key` | Only when using `--file-key` / `keyStorage: file` (mode `0600`) |
| `secrets.json` | Encrypted upstream credentials + gateway token secret (mode `0600`) |

`jackline init` stores the master key in the **OS keychain** by default (macOS Keychain, Windows Credential Manager, Linux Secret Service via `secret-tool`).

Opt out (less secure — prints a warning):

```bash
jackline init --file-key
```

`jackline init --force` overwrites an existing config and master key (and mints a new gateway token). Existing plaintext `master.key` installs are migrated into the keychain on first use when possible.

## Security notes

- **`/mcp` requires** `Authorization: Bearer jkl_…` (same token format as hosted Jackline). `/health` stays open for liveness.
- The token is long-lived and stable across `jackline serve` restarts; it is not rotated automatically.
- Secrets are encrypted at rest with the local master key (`@jackline/crypto`). Prefer keychain storage for that key so backups/sync of `~/.jackline` do not include the wrapping secret.
- Config and secret files are written with mode `0600`.
- The gateway listens on `127.0.0.1` by default — it is meant for local clients, not exposure to the network.
- Treat the gateway bearer (and any `master.key` if you opted into `--file-key`) like passwords; losing the master key makes stored secrets unrecoverable.
- Localhost binding + bearer slows down casual loopback abuse; it does not protect a fully compromised machine that can read your MCP client config.

## Development (monorepo)

From the repo root:

```bash
pnpm install
pnpm --filter @jackline/cli dev      # tsx watch
pnpm --filter @jackline/cli build    # tsup → dist/
pnpm --filter @jackline/cli typecheck
```

Workspace packages `@jackline/crypto` and `@jackline/shared` are **bundled into `dist`** at build time so the published package does not depend on private workspace packages.

## Publishing (`@jackline/cli`)

Releases are meant to go out **only from GitHub Actions** via npm **trusted publishing** (OIDC). There should be no long-lived `NPM_TOKEN` for routine publishes.

### One-time setup (maintainer)

1. Own the `@jackline` npm org; enforce 2FA for publishers.
2. On npmjs.com → `@jackline/cli` → Trusted Publisher:
   - GitHub user/org: `kvpendergast`
   - Repository: `mesh`
   - Workflow filename: `publish-cli.yml`
   - Allowed action: `npm publish`
3. Bootstrap the first package version if npm requires it (short-lived token), then **revoke** that token. Later releases use OIDC only.

Workflow: [`.github/workflows/publish-cli.yml`](../../.github/workflows/publish-cli.yml).

### Cut a release

1. Bump `"version"` in `apps/cli/package.json` (keep in sync with any user-facing docs).
2. Merge to `main`.
3. Tag and push (tag must match the package version):

```bash
git tag cli-v0.1.0
git push origin cli-v0.1.0
```

4. Confirm the **Publish CLI** workflow succeeded on GitHub Actions.
5. Verify: `npm view @jackline/cli version`

Do **not** run `npm publish` from a laptop for normal releases.

## License

MIT
