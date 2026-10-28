# syntax=docker/dockerfile:1
# Build from the repo root: docker build -f apps/server/Dockerfile .
# The case folder (SQLite file, glossary, team notes, build logs) is not in the
# image; mount it at runtime and point DB_PATH / CASE_DIR at it.

ARG NODE_VERSION=26.12.1

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# No update notices in build logs; pnpm's own install scripts aren't needed to run it.
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
RUN npm install -g --ignore-scripts pnpm@12.15.0
WORKDIR /app
# better-sqlite3 compiles from source when no prebuilt binary matches this Node.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc .nvmrc ./
COPY apps/server/package.json apps/server/

FROM base AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile --filter server
COPY apps/server apps/server
RUN pnpm --filter server build

FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile --prod --filter server

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=4000 \
  RULES_PATH=/app/apps/server/data/team-rules.json
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY apps/server/package.json ./apps/server/
# The one writable path (team rules); mount a volume here to keep rules across deploys.
RUN mkdir -p apps/server/data && chown node:node apps/server/data
USER node
WORKDIR /app/apps/server
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/server.js"]
