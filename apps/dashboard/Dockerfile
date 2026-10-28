# syntax=docker/dockerfile:1
# Build from the repo root: docker build -f apps/dashboard/Dockerfile .
# API_URL is read at runtime on the server only; set it to the API's internal URL.

ARG NODE_VERSION=26.12.1

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# No update notices in build logs; pnpm's own install scripts aren't needed to run it.
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install -g --ignore-scripts pnpm@12.15.0
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc .nvmrc ./
COPY apps/dashboard/package.json apps/dashboard/

FROM base AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile --filter dashboard
COPY apps/dashboard apps/dashboard
RUN pnpm --filter dashboard build

# Full prod node_modules rather than `output: "standalone"`: pdfkit reads its
# font metrics from its own folder at runtime, which file tracing can miss.
FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile --prod --filter dashboard

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  HOSTNAME=0.0.0.0 \
  PORT=4000
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/dashboard/node_modules ./apps/dashboard/node_modules
COPY --from=build --chown=node:node /app/apps/dashboard/.next ./apps/dashboard/.next
COPY apps/dashboard/package.json apps/dashboard/next.config.ts ./apps/dashboard/
COPY apps/dashboard/public ./apps/dashboard/public
RUN rm -rf apps/dashboard/.next/cache && mkdir apps/dashboard/.next/cache && chown node:node apps/dashboard/.next/cache
USER node
WORKDIR /app/apps/dashboard
EXPOSE 4000
CMD ["node_modules/.bin/next", "start"]
