# Mesh

Open-source, self-hostable **MCP policy gateway** + control-plane API and admin UI.

Clients (Cursor, Claude Code, internal agents) connect to Mesh as an MCP server. Mesh authenticates the caller, evaluates policy, proxies allowed tool calls, and records an audit trail.

## Status

**Phase 1 — foundation (in progress)**

| Area | Status |
| --- | --- |
| Monorepo (`pnpm`, TypeScript) | Done |
| Postgres + Drizzle (`tenants`, `memberships`, auth tables, `secrets`) | Done |
| Envelope crypto (`@mesh/crypto`) | Done |
| Better Auth (email/password + sessions) | Done |
| Control-plane API (`@mesh/api`) — health, signup, `/me`, product CRUD through secrets, OpenAPI | Done |
| Tenancy gate (`single` / `multi`) | Done |
| Request context + structured logging | Done |
| Admin UI (`@mesh/web`) | Steel Lattice; Dashboard, Settings, Servers quick-add catalog, connections, audit |
| Connector presets | Linear, Notion, Atlassian, Gmail/Drive/Calendar/Docs, GitHub, Sentry |
| MCP gateway (`@mesh/gateway`) | Streamable HTTP `/mcp`, policy filter, proxy, audit; upstream Zod schemas |
| Tool sync | `POST /servers/:id/sync-tools` stores description + inputSchema |
| Upstream auth | `api_key` + `oauth` (access token, client credentials, refresh) |
| Identity | OIDC SSO (Better Auth genericOAuth), SCIM Users, invites, team-scoped `delegated_admin` |
| Custom API / OpenAPI | `kind: api` HTTP proxy + OpenAPI JSON import via `docsUrl` |
| Audit trail | Gateway writes allow/deny/upstream_error with optional request/response JSON |
| Compose stand-up | `deploy/docker-compose.yml` (dev) + `deploy/compose.prod.yml` (prod; optional gateway-split / byo-edge overlays) |
| Public Admin API | OAuth2 `client_credentials` on `/api/v1/oauth/token`; Bearer on `/api/v1/*` |
| Docs site | Zudoku (`apps/docs`) — API reference auto-generated from OpenAPI |

Next: My Access / access requests, OTEL, rate limits, mTLS.

## Stack

- **API:** Hono + `@hono/zod-openapi`
- **DB:** Drizzle + Postgres
- **Auth:** Better Auth (identity only; Mesh owns tenants/memberships)
- **Errors:** neverthrow in services; HTTP envelope at the API edge
- **License:** MIT

## Prerequisites

- Node 22+
- pnpm 10.16+ (supply-chain settings in `pnpm-workspace.yaml`: release age, trust policy, exotic subdeps)
- Postgres 16+

## Setup

```bash
pnpm install
cp .env.example .env
```

Generate secrets and put them in `.env`:

```bash
openssl rand -base64 32   # MESH_MASTER_KEY (base64)
openssl rand -base64 32   # BETTER_AUTH_SECRET
```

Set `DATABASE_URL` to your Postgres instance, for example:

```bash
# local Postgres on default port
DATABASE_URL=postgresql://mesh:mesh@127.0.0.1:5432/mesh

# or Docker (example: publish container 5432 → host 5433)
docker run -d --name mesh-pg \
  -e POSTGRES_USER=mesh \
  -e POSTGRES_PASSWORD=mesh \
  -e POSTGRES_DB=mesh \
  -p 5433:5432 postgres:16

DATABASE_URL=postgresql://mesh:mesh@127.0.0.1:5433/mesh
```

Also set:

```bash
BETTER_AUTH_URL=http://127.0.0.1:8080
WEB_ORIGIN=http://127.0.0.1:5173
MESH_TENANCY=single   # or multi
```

Also: `deploy/docker-compose.yml` for a **dev** single-host stand-up (Postgres + migrate + api + gateway + web + docs).

```bash
cp .env.example .env   # set MESH_MASTER_KEY, BETTER_AUTH_SECRET
docker compose -f deploy/docker-compose.yml up --build
```

### Production Compose (recommended self-host)

Multi-stage images (`deploy/Dockerfile`) + optional Caddy edge (`deploy/compose.prod.yml`).
Default topology: **UI + API + MCP on one origin** (simplest cookies/CORS). Caddy is convenience, not required.

```bash
cp deploy/.env.prod.example .env.prod
# set MESH_MASTER_KEY and BETTER_AUTH_SECRET
docker compose -f deploy/compose.prod.yml --env-file .env.prod up --build -d
```

| URL | Service |
| --- | --- |
| http://localhost/ | Admin UI (API at `/api`, MCP at `/mcp`) |
| http://docs.localhost/ | Docs |
| http://localhost/openapi.json | OpenAPI JSON |
| http://localhost/health | API health |

**HTTPS:** set `MESH_SITE_ADDRESS` / `MESH_DOCS_SITE_ADDRESS` to bare hostnames (no `http://`), align `WEB_ORIGIN` / `BETTER_AUTH_URL` / `MESH_PUBLIC_*` to `https://…`, and ensure ports 80/443 are reachable.

**Other topologies** (see `apps/docs/pages/self-hosting.mdx`):

```bash
# Gateway on its own published port; Caddy = control plane only
docker compose -f deploy/compose.prod.yml -f deploy/compose.gateway-split.yml \
  --env-file .env.prod up --build -d

# No Caddy — publish api/gateway/web/docs for your own reverse proxy
docker compose -f deploy/compose.prod.yml -f deploy/compose.byo-edge.yml \
  --env-file .env.prod up --build -d
```

Build a single target:

```bash
docker build -f deploy/Dockerfile --target api -t mesh-api .
docker build -f deploy/Dockerfile --target gateway -t mesh-gateway .
docker build -f deploy/Dockerfile --target web -t mesh-web .
docker build -f deploy/Dockerfile --target docs -t mesh-docs .
```

Migrate and start:

```bash
pnpm db:migrate
pnpm --filter @mesh/api dev
# or all apps: pnpm dev
```

API listens on `http://127.0.0.1:8080` by default.

- Health: `GET /health`
- OpenAPI JSON: `GET /docs`
- Better Auth: `/api/auth/*`
- Mesh v1: `/api/v1/*`
- OAuth2 token (client_credentials): `POST /api/v1/oauth/token`
- Docs site (Zudoku): `pnpm docs:dev` → http://127.0.0.1:3000 (exports OpenAPI via `pnpm openapi:export`)

## Smoke test

### Create organization (first org in `single` mode)

```bash
curl -sS -c /tmp/mesh-cookies.txt -X POST http://127.0.0.1:8080/api/v1/signup \
  -H 'content-type: application/json' \
  -d '{
    "email": "you@example.com",
    "password": "password123",
    "name": "You",
    "organizationName": "Acme"
  }' | jq .
```

Expect `201` with `user`, `tenant`, `membership`, and session cookies.

In **`MESH_TENANCY=single`**, a second signup returns `409` `TENANT_LIMIT_REACHED`.

### Sign in (if an org already exists)

```bash
curl -sS -c /tmp/mesh-cookies.txt -X POST http://127.0.0.1:8080/api/auth/sign-in/email \
  -H 'content-type: application/json' \
  -d '{
    "email": "you@example.com",
    "password": "password123"
  }' | jq .
```

### Current user + memberships

```bash
curl -sS -b /tmp/mesh-cookies.txt http://127.0.0.1:8080/api/v1/me | jq .
```

Expect `200` with:

```json
{
  "success": true,
  "data": {
    "user": { "id": "...", "email": "...", "name": "..." },
    "memberships": [
      {
        "id": "...",
        "role": "full_admin",
        "tenant": { "id": "...", "name": "...", "slug": "..." }
      }
    ]
  }
}
```

Without cookies, `/me` returns `401` `UNAUTHORIZED`.

### Servers (tenant-scoped)

Use a membership `tenant.id` from `/me` as `X-Mesh-Tenant-Id`. Mutations require `full_admin`.

```bash
TENANT_ID='…' # from /me → data.memberships[0].tenant.id

# Create
curl -sS -b /tmp/mesh-cookies.txt -X POST http://127.0.0.1:8080/api/v1/servers \
  -H 'content-type: application/json' \
  -H "X-Mesh-Tenant-Id: $TENANT_ID" \
  -d '{
    "name": "Example MCP",
    "baseUrl": "https://mcp.example.com",
    "authMethod": "api_key",
    "kind": "mcp"
  }' | jq .

# List (cursor page; default limit 50, max 100)
curl -sS -b /tmp/mesh-cookies.txt 'http://127.0.0.1:8080/api/v1/servers?limit=50' \
  -H "X-Mesh-Tenant-Id: $TENANT_ID" | jq .

# Next page (when data.nextCursor is non-null)
curl -sS -b /tmp/mesh-cookies.txt \
  "http://127.0.0.1:8080/api/v1/servers?limit=50&cursor=$NEXT_CURSOR" \
  -H "X-Mesh-Tenant-Id: $TENANT_ID" | jq .

# Get / patch / delete
# GET    /api/v1/servers/:id
# PATCH  /api/v1/servers/:id   (e.g. {"status":"active"})
# DELETE /api/v1/servers/:id
```

List response shape: `{ "success": true, "data": { "items": [...], "nextCursor": "…" | null } }`.

New servers start as `status: pending`, `health: unknown`. `health` is gateway-owned (not patchable here).

### Tools (tenant-scoped)

Tools belong to a server. Mutations require `full_admin`. Names are unique per `(tenant, server)`.

```bash
# Create (default status: needs_review)
curl -sS -b /tmp/mesh-cookies.txt -X POST http://127.0.0.1:8080/api/v1/tools \
  -H 'content-type: application/json' \
  -H "X-Mesh-Tenant-Id: $TENANT_ID" \
  -d '{
    "name": "search",
    "serverId": "'"$SERVER_ID"'"
  }' | jq .

# List (optional serverId filter)
curl -sS -b /tmp/mesh-cookies.txt \
  "http://127.0.0.1:8080/api/v1/tools?limit=50&serverId=$SERVER_ID" \
  -H "X-Mesh-Tenant-Id: $TENANT_ID" | jq .

# PATCH /api/v1/tools/:id  e.g. {"status":"active"}
# GET|DELETE /api/v1/tools/:id
```

### Roles (tenant-scoped)

Roles are `grant` or `deny` and bind tools via `role_tools`. Names unique per tenant. System roles cannot be deleted (or renamed/retyped).

```bash
# Create
curl -sS -b /tmp/mesh-cookies.txt -X POST http://127.0.0.1:8080/api/v1/roles \
  -H 'content-type: application/json' \
  -H "X-Mesh-Tenant-Id: $TENANT_ID" \
  -d '{"name":"readers","type":"grant"}' | jq .

# Attach / replace / detach tools
# POST   /api/v1/roles/:id/tools          {"toolId":"..."}
# PUT    /api/v1/roles/:id/tools          {"toolIds":["..."]}
# DELETE /api/v1/roles/:id/tools/:toolId

# GET /api/v1/roles  |  GET|PATCH|DELETE /api/v1/roles/:id
```

`GET /roles/:id` returns `toolIds`.

### Users (tenant-scoped)

List members of the active tenant. Create **service** users (non-interactive subjects for Connections) as `full_admin`. Humans still come from `/signup`. Service users get a `member` membership; optional email, otherwise a synthetic unique address is assigned.

```bash
curl -sS -b /tmp/mesh-cookies.txt -X POST http://127.0.0.1:8080/api/v1/users \
  -H 'content-type: application/json' \
  -H "X-Mesh-Tenant-Id: $TENANT_ID" \
  -d '{"kind":"service","name":"ci-bot"}' | jq .

# GET /api/v1/users?kind=service
# GET /api/v1/users/:id
```

### Clients (tenant-scoped)

Mesh front-door registrations: `interactive` (human harnesses) or `service` (machine / public Admin API). Names unique per tenant.

```bash
curl -sS -b /tmp/mesh-cookies.txt -X POST http://127.0.0.1:8080/api/v1/clients \
  -H 'content-type: application/json' \
  -H "X-Mesh-Tenant-Id: $TENANT_ID" \
  -d '{"name":"cursor","kind":"interactive"}' | jq .

# GET /api/v1/clients?kind=interactive
# GET|PATCH|DELETE /api/v1/clients/:id
```

#### Public Admin API (OAuth2 client_credentials)

`service` clients can mint OAuth2 credentials. Access tokens authenticate the same `/api/v1` routes as session cookies (no `X-Mesh-Tenant-Id` required; tenant comes from the token).

```bash
# Create a service client + mint credentials (client_secret shown once)
curl -sS -b /tmp/mesh-cookies.txt -X POST http://127.0.0.1:8080/api/v1/clients \
  -H 'content-type: application/json' \
  -H "X-Mesh-Tenant-Id: $TENANT_ID" \
  -d '{"name":"ci-bot","kind":"service"}' | jq .

CLIENT_ID='…'
curl -sS -b /tmp/mesh-cookies.txt -X POST \
  "http://127.0.0.1:8080/api/v1/clients/$CLIENT_ID/credentials" \
  -H 'content-type: application/json' \
  -H "X-Mesh-Tenant-Id: $TENANT_ID" \
  -d '{}' | jq .
# → data.clientId, data.clientSecret, data.tokenUrl

# Exchange for an access token
curl -sS -X POST http://127.0.0.1:8080/api/v1/oauth/token \
  -H 'content-type: application/x-www-form-urlencoded' \
  -d "grant_type=client_credentials&client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET" | jq .
# → access_token, token_type=Bearer, expires_in

# Call the Admin API with the Bearer token
curl -sS http://127.0.0.1:8080/api/v1/servers \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq .

# Rotate / revoke
# POST   /api/v1/clients/:id/credentials   (rotates secret; revokes outstanding tokens)
# DELETE /api/v1/clients/:id/credentials
```

### Connections (tenant-scoped)

Policy target `(client, user)`. User must be a tenant member. Detail includes `roleIds` and `toolOverrides`.

```bash
curl -sS -b /tmp/mesh-cookies.txt -X POST http://127.0.0.1:8080/api/v1/connections \
  -H 'content-type: application/json' \
  -H "X-Mesh-Tenant-Id: $TENANT_ID" \
  -d '{"clientId":"'"$CLIENT_ID"'","userId":"'"$USER_ID"'"}' | jq .

# Roles: POST|PUT /connections/:id/roles  DELETE /connections/:id/roles/:roleId
# Overrides: POST|PUT /connections/:id/tool-overrides
#            DELETE /connections/:id/tool-overrides/:toolId
# Credentials (gateway bearer): POST /connections/:id/credentials  (plaintext once)
#   GET /connections/:id/credentials  |  DELETE /connections/:id/credentials/:secretId
# GET /connections  |  GET|PATCH|DELETE /connections/:id
```

Mint returns `token` (`msh_<secretId>.<secret>`) and an `mcp` snippet for Cursor/Claude:

```json
{
  "mcpServers": {
    "mesh": {
      "url": "http://127.0.0.1:8081/mcp",
      "headers": { "Authorization": "Bearer msh_….…" }
    }
  }
}
```

One `gateway_token` per connection (schema unique). Rotate = revoke, then mint again.

Gateway MCP (`GATEWAY_PORT`, default 8081) — Streamable HTTP at `/mcp`. Auth via minted connection credential. `tools/list` is policy-filtered; `tools/call` proxies to upstream MCP or custom HTTP APIs (`kind: api` tools with method/path bindings). Upstream secrets: `api_key` or `oauth`.

```bash
# Initialize (example JSON-RPC)
curl -sS http://127.0.0.1:8081/mcp \
  -H "Authorization: Bearer $MESH_GATEWAY_TOKEN" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}' | jq .

# tools/list
curl -sS http://127.0.0.1:8081/mcp \
  -H "Authorization: Bearer $MESH_GATEWAY_TOKEN" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | jq .
```

### Secrets (tenant-scoped)

Encrypted credentials via `@mesh/crypto` (local AES-GCM). List/get return **metadata only**. Reveal is admin-only.

Bindings (exactly one):
- server-level: `serverId`
- per-user upstream: `serverId` + `userId`
- gateway token: `connectionId`

```bash
curl -sS -b /tmp/mesh-cookies.txt -X POST http://127.0.0.1:8080/api/v1/secrets \
  -H 'content-type: application/json' \
  -H "X-Mesh-Tenant-Id: $TENANT_ID" \
  -d '{
    "kind": "api_key",
    "name": "example",
    "value": "super-secret",
    "serverId": "'"$SERVER_ID"'"
  }' | jq .

# GET  /api/v1/secrets/:id/value   (decrypt; full_admin)
# GET|PATCH|DELETE /api/v1/secrets/:id
```

### Audit events (tenant-scoped)

Gateway writes one row per `tools/call` (`allow` | `deny` | `allow_upstream_error`). No args/response payloads. Membership can list/get; no mutations.

```bash
curl -sS -b /tmp/mesh-cookies.txt "http://127.0.0.1:8080/api/v1/audit-events?limit=20" \
  -H "X-Mesh-Tenant-Id: $TENANT_ID" | jq .

# Filters: connectionId, clientId, userId, toolId, serverId, outcome
# GET /api/v1/audit-events/:id
```

## API notes

- Success: `{ "success": true, "data": ... }`
- Error: `{ "success": false, "error": { "code", "message", "details?" } }`
- List endpoints return cursor pages: `{ items, nextCursor }` (`limit` + optional `cursor` query)
- `/me` returns **all** memberships for the session user (client chooses active tenant later)
- Signup creates Better Auth user + Mesh tenant + `full_admin` membership
- Tenant-scoped routes run `tenantContextMiddleware` (`X-Mesh-Tenant-Id` + membership)
- Admin-only routes also declare `middleware: [requireFullAdmin]` on the route (Express-style)

## Observability

The API logs structured JSON to stdout (pretty-printed in development). Set `LOG_LEVEL` (`info` default).

**Correlation**

| Header / field | Role |
| --- | --- |
| `X-Request-Id` | Honored if sent; otherwise generated. Echoed on every response. |
| `traceparent` | Optional W3C header; `traceId` is extracted into logs for later gateway joining. |

Stable log fields operators can ship to Loki/ELK/CloudWatch and alert on: `requestId`, `traceId`, `tenantId`, `userId`, `authMethod`, `route`, `method`, `status`, `durationMs`, `errorCode`.

Request-complete lines are emitted for every call. Secrets, cookies, and `Authorization` values are never logged.

**Alerting (self-hosted)**

No built-in pager. Typical setup:

1. Alert on `level=error` or `errorCode` + 5xx rate from log shipper
2. Probe `GET /health` for liveness
3. Example Loki/LogQL-style filter: `{app="mesh-api"} \| json \| status >= 500`

Prometheus metrics and OTEL export are follow-ons; field names stay OTEL-friendly so export is additive.

## Personal CLI

Local MCP policy gateway (no control-plane required):

```bash
npm install -g @mesh/cli   # when published; or pnpm --filter @mesh/cli build && node apps/cli/dist/index.js
mesh init && mesh catalog && mesh serve
```

`/mcp` requires a long-lived local bearer (`msh_…`) printed by `mesh init` / `mesh serve` / `mesh auth show`. See [`apps/cli/README.md`](apps/cli/README.md).

## Repo layout

```
apps/
  api/       # control-plane (Hono)
  web/       # Vite/React admin UI (Steel Lattice + shadcn)
  gateway/   # MCP gateway (Streamable HTTP)
  cli/       # personal Mesh CLI (@mesh/cli)
packages/
  shared/    # env, errors, tenancy, public DTOs, connector catalog
  db/        # Drizzle schema + migrations
  auth/      # Better Auth instance
  crypto/    # AES-GCM envelope encryption
  policy/    # policy evaluation
```

## License

MIT
