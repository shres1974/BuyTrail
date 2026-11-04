# syntax=docker/dockerfile:1.7
# One image for both roles: `web` (default CMD) and `worker` (compose overrides the command).
# Node version matches .nvmrc; pnpm is the version pinned in package.json (via corepack).
ARG NODE_VERSION=24.22.2

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

# ── Dependencies (cached unless manifests or the lockfile change) ─────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc .nvmrc ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/config/package.json packages/config/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/providers/package.json packages/providers/
COPY packages/services/package.json packages/services/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ── Build: generate Prisma client and the Next.js production build ───────────────────────
FROM deps AS build
COPY . .
# Build-time placeholders only so config validation passes during `next build`; pages render
# per request, and real values are supplied at runtime by the environment.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build \
    AUTH_SECRET=build_time_placeholder_not_used_at_runtime \
    OBJECT_STORAGE_ACCESS_KEY=build OBJECT_STORAGE_SECRET_KEY=build \
    pnpm build

# ── Runtime ────────────────────────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "start:web"]
