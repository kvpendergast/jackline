# AGENTS.md

## Cursor Cloud specific instructions

Jackline is a pnpm + TypeScript monorepo (Node 22, pnpm 10.33.3). See `README.md` for
the product overview and the full API/smoke-test reference; only non-obvious, durable
setup/run caveats are captured here.

### Services and how to run them
- `pnpm dev` runs the three core dev services in parallel with hot reload:
  `@jackline/api` (:8080), `@jackline/web` (Vite, :5173), `@jackline/gateway` (:8081).
  Run it under a persistent tmux session so it survives across commands.
- The web app proxies `/api` to `http://127.0.0.1:8080`, so the API must be up for the UI to work.
- `apps/docs` (Zudoku, :3000) and `apps/cli` are optional and intentionally excluded from `pnpm dev`.
- Standard scripts live in the root `package.json`: `pnpm build`, `pnpm test`, `pnpm lint`,
  `pnpm db:migrate`, `pnpm smoke`.
- `pnpm lint` is currently a no-op in every package (`echo "lint later"`); there is no real linter wired up.
- `pnpm test` only has real tests in `@jackline/api` (chat) and `@buildstuff/jackline` (CLI); other packages echo "no tests yet".

### Postgres (required, not auto-started)
- The API and gateway both require Postgres and validate env strictly on startup.
- Postgres is NOT started automatically. Start the cluster before running anything that
  touches the DB: `sudo pg_ctlcluster 16 main start`. The dev role/db are
  `jackline`/`jackline` (password `jackline`) matching `DATABASE_URL` in `.env`.
- After Postgres is up, apply migrations with `pnpm db:migrate` (safe to re-run; idempotent).

### `.env` gotcha (important)
- Env is loaded via Node's built-in `loadEnvFile` (see `apps/api/src/index.ts`), and the
  Zod schema in `packages/shared/src/env/schema.ts` is `.strict()`. Optional URL/OIDC vars
  (`JACKLINE_PUBLIC_API_URL`, `JACKLINE_PUBLIC_MCP_URL`, `JACKLINE_INTERNAL_MCP_URL`,
  `JACKLINE_OIDC_*`) are `.optional()` and reject empty strings.
- Copying `.env.example` verbatim leaves these keys as empty strings, which FAILS startup
  ("Invalid URL" / "Too small"). Fix: OMIT those optional keys entirely (leave them unset)
  rather than setting them to empty. A minimal working `.env` only needs `JACKLINE_MASTER_KEY`,
  `BETTER_AUTH_SECRET`, `DATABASE_URL`, `BETTER_AUTH_URL`, plus the non-optional defaults.
- Generate the two secrets with `openssl rand -base64 32` each.

### In-product Chat testing notes
- `POST /api/v1/chat` (and the UI Chat drawer) requires at least ONE allowed tool on the
  user's auto-provisioned "Jackline Chat" connection. With zero tools the MCP handshake
  fails with `MCP error -32601: Method not found`, and the web drawer keeps Send disabled.
  To expose a tool end-to-end: create a server, create a tool, set the tool `active`, set the
  server `active`, create a `grant` role with that tool, then attach the role to the Jackline
  Chat connection (see `README.md` smoke-test curl examples).
- The chat request body must be AG-UI `RunAgentInput` shape: messages use `{id, role, content}`
  (string `content`, not `parts`), and top-level `tools` must be an array (e.g. `[]`).

### Tenancy
- `JACKLINE_TENANCY=single` (the documented default) allows only ONE organization; a second
  `/signup` returns `409 TENANT_LIMIT_REACHED`. Set `JACKLINE_TENANCY=multi` in `.env` (and
  restart) if you need multiple orgs, e.g. to create a throwaway test org via the API.
