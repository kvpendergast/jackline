# Mesh

Open-source agent access-control mesh (MCP gateway + control plane).

## Status

Phase 1 foundation in progress.

## Prerequisites

- Node 22+
- pnpm 9+
- Postgres 16 (later in Phase 1)

## Setup

```bash
pnpm install
cp .env.example .env
# fill MESH_MASTER_KEY and BETTER_AUTH_SECRET later
pnpm dev
```

## License

MIT
