# Contributing to Jackline

Thanks for helping improve Jackline. This repo is a pnpm monorepo (API, gateway, admin UI, docs, CLI, and shared packages).

## Quick start

1. Prerequisites: **Node 22+**, **pnpm 10.16+**, **Postgres 16+**
2. Copy env and set secrets (see [README](README.md#setup)):

   ```bash
   pnpm install
   cp .env.example .env
   ```

3. Migrate and run:

   ```bash
   pnpm db:migrate
   pnpm dev
   ```

   Or use Docker Compose — [Self-hosting](apps/docs/pages/self-hosting.mdx) / README “Docker”.

Optional: `pnpm env:check` fails fast on missing required env.

## Development loop

| Command | Purpose |
| --- | --- |
| `pnpm dev` | API + web + gateway (parallel) |
| `pnpm docs:dev` | Docs site (Zudoku) |
| `pnpm test` | Unit tests (no Postgres) |
| `pnpm test:integration` | Black-box API + gateway against Postgres |
| `pnpm --filter @jackline/web exec tsc -p tsconfig.json --noEmit` | Typecheck a package |

CI (`.github/workflows/ci.yml`) runs typecheck, unit tests, web build, integration, and betterleaks on every PR.

## Pull requests

- Branch from `main`; keep changes focused.
- Prefer small PRs with a clear summary and test plan.
- Add or extend tests when fixing bugs or changing gateway/API behavior.
- Do not commit `.env`, secrets, or production credentials.
- Match existing TypeScript style; avoid drive-by refactors unrelated to the change.

## Architecture pointers

- **Control plane:** `apps/api` (Hono + OpenAPI)
- **MCP gateway:** `apps/gateway` (policy, proxy, audit)
- **Admin UI:** `apps/web`
- **Shared types / env:** `packages/shared`
- **Auth helpers:** `packages/auth` (Better Auth)
- **Integration suite:** `packages/integration-tests`

Product docs live under `apps/docs/pages/` (self-hosting, Cursor connect, authentication).

## Reporting issues

- Bugs and features: GitHub Issues on this repository.
- Security vulnerabilities: see [SECURITY.md](SECURITY.md) — do not open a public issue for sensitive reports.

## Code of conduct

Participation is covered by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
