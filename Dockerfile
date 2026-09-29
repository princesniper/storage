# syntax=docker/dockerfile:1
#
# Production image for the Telegram-backed media storage app (Next.js standalone).
# - Node 22 LTS on Debian bookworm-slim (glibc — required by sharp's prebuilt libvips).
# - No devDependencies, no .env, no secrets, no SQLite files in the final image.
# - Migrations run via Fly release_command (npx prisma migrate deploy), NOT at build.
# - The container runs `node server.js` directly (no Bun, no Caddy in prod).
#
# Build (on any Docker host / Fly remote builder):
#   docker build -t growplants-media .
# Run locally (needs a reachable Postgres):
#   docker run -p 8080:8080 --env-file .env.production.local growplants-media

# ---------- deps: full install for the build ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# ---------- builder: generate client + production build ----------
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Prisma Client for the PostgreSQL provider (offline-safe: no DB connection needed).
RUN npx prisma generate
# Standalone output + static/public are assembled by the build script
# (next build && cp .next/static + public into .next/standalone).
ARG DATABASE_URL
ARG AUTH_SECRET
ARG ADMIN_EMAIL
ARG ADMIN_PASSWORD

ENV DATABASE_URL=$DATABASE_URL \
    AUTH_SECRET=$AUTH_SECRET \
    ADMIN_EMAIL=$ADMIN_EMAIL \
    ADMIN_PASSWORD=$ADMIN_PASSWORD

RUN npm run build

# ---------- runner: minimal production image ----------
FROM node:22-bookworm-slim AS runner
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Prisma schema + migrations + CLI for `prisma migrate deploy` (release command).
# `prisma` is a production dependency, so --omit=dev keeps the CLI available.
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci --omit=dev \
 && npx prisma generate \
 && npm cache clean --force

# Standalone server (already contains .next/static + public via the build script).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./

USER nextjs
EXPOSE 8080

# Standalone server.js honors PORT + HOSTNAME (verified: defaults 3000 / 0.0.0.0).
CMD ["node", "server.js"]
