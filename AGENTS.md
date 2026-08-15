# AGENTS.md

## Cursor Cloud specific instructions

Jackline is a pnpm + TypeScript monorepo (Node 22, pnpm 10.33.3). It is an MCP
control plane. See `README.md` for the full product/API walkthrough and standard
commands; this section only captures non-obvious cloud-environment caveats.

### Services and ports (dev)

- `@jackline/api` — control-plane HTTP API on `127.0.0.1:8080` (`/health`, `/api/*`, `/docs`).
- `@jackline/gateway` — MCP policy gateway on `127.0.0.1:8081` (`/mcp`, `/health`).
- `@jackline/web` — Vite/React admin UI on `127.0.0.1:5173` (proxies `/api` → 8080).
- `@jackline/docs` — optional Zudoku docs site on `:3000` (`pnpm docs:dev`).
- `@buildstuff/jackline` (`apps/cli`) — a separate, standalone local-gateway product; it needs no Postgres.

Run all three server apps at once with `pnpm dev` (api + gateway + web, in parallel).

### Postgres (must be started each boot)

Postgres 16 is installed at the system level and its data (database `jackline`,
role `jackline`/`jackline`, applied migrations) is preserved in the environment,
but the server process does NOT auto-start on a fresh VM. Start it before running
migrations or the API/gateway:

```bash
sudo pg_ctlcluster 16 main start   # listens on 127.0.0.1:5432
```

If the database is ever missing/reset, recreate and migrate:

```bash
sudo -u postgres psql -c "CREATE ROLE jackline WITH LOGIN PASSWORD 'jackline' CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE jackline OWNER jackline;"
pnpm db:migrate
```

### Environment file (`.env`)

A working `.env` already exists at the repo root (gitignored, so not in the repo)
with dev secrets and `DATABASE_URL=postgresql://jackline:jackline@127.0.0.1:5432/jackline`.

Gotcha: the env schema (`packages/shared/src/env/schema.ts`) treats OPTIONAL vars
as present when set to an empty string, which fails validation (e.g. the
`JACKLINE_OIDC_*` and `JACKLINE_PUBLIC_*` URL vars). Unlike `.env.example`, the
working `.env` OMITS those optional lines entirely rather than leaving them blank.
Leave optional URL/OIDC vars unset (no blank `KEY=` lines) unless you provide real values.

### Lint / test / build

- `pnpm build` — real (tsc / vite / tsup across all packages).
- `pnpm test` — only `apps/cli` has real tests (node:test); all other packages are `echo "no tests yet"` placeholders.
- `pnpm lint` — placeholder (`echo "lint later"`) everywhere; no linter is configured.
- `pnpm smoke` — golden-path end-to-end check (`apps/api/scripts/smoke-golden-path.ts`); requires Postgres + a running api + gateway.
