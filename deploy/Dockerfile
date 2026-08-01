FROM node:22-bookworm

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile

ENV NODE_ENV=development
EXPOSE 8080 8081 5173

CMD ["pnpm", "dev"]
