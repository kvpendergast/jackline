# syntax=docker/dockerfile:1
#
# Multi-target production image for Jackline.
#   docker build -f deploy/Dockerfile --target api -t jackline-api .
#   docker build -f deploy/Dockerfile --target gateway -t jackline-gateway .
#   docker build -f deploy/Dockerfile --target web -t jackline-web .
#   docker build -f deploy/Dockerfile --target docs -t jackline-docs .
#   docker build -f deploy/Dockerfile --target migrate -t jackline-migrate .

FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN corepack enable \
  && corepack prepare pnpm@10.33.3 --activate \
  && apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile

# --- Runtime: API ---
FROM deps AS api
ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${API_PORT:-8080}/health" || exit 1
CMD ["pnpm", "--filter", "@jackline/api", "start"]

# --- Runtime: Gateway ---
FROM deps AS gateway
ENV NODE_ENV=production
ENV GATEWAY_HOST=0.0.0.0
EXPOSE 8081
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${GATEWAY_PORT:-8081}/health" || exit 1
CMD ["pnpm", "--filter", "@jackline/gateway", "start"]

# --- One-shot: DB migrate ---
FROM deps AS migrate
ENV NODE_ENV=production
CMD ["pnpm", "db:migrate"]

# --- Build: Admin UI ---
FROM deps AS web-build
RUN pnpm --filter @jackline/web build

FROM nginx:1.27-alpine AS web
COPY deploy/nginx/web.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1

# --- Build: Docs (uses committed apps/docs/apis/openapi.json) ---
FROM deps AS docs-build
RUN pnpm --filter @jackline/docs build

FROM nginx:1.27-alpine AS docs
COPY deploy/nginx/docs.conf /etc/nginx/conf.d/default.conf
COPY --from=docs-build /app/apps/docs/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
