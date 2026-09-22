# Storage — Telegram-Backed Image Hosting Platform

A private, single-admin image storage dashboard backed by Telegram. Upload images to your own Telegram private channels via a secure admin dashboard, and serve them publicly via stable URLs that can be embedded in any external system (e.g. GrowPlants product images).

## Architecture

```
Admin Browser  →  Next.js (App Router + API routes)
                  ├── AuthService (NextAuth Credentials, bcrypt)
                  ├── TelegramService (GramJS MTProto, isolated)
                  ├── FileService (validation, magic bytes)
                  ├── ChannelService (multi-channel registration)
                  ├── UrlService (gp_<12 chars> public IDs)
                  ├── CacheService (LRU memory cache)
                  └── AuditService (append-only UploadLog)
                        ↓                    ↓
                  SQLite (Prisma)    Telegram MTProto (private channels)
                                              ↓
                              https://storage.../i/gp_x82ka91
                                              ↓
                                       GrowPlants <img>
```

## Stack

- **Next.js 16** with App Router + Turbopack
- **TypeScript 5** strict
- **Prisma + SQLite** (metadata, audit logs)
- **GramJS** (`telegram` npm) for MTProto user-account auth
- **NextAuth v4** Credentials provider (bcrypt-hashed admin password, JWT session)
- **TanStack Query** for server state
- **Tailwind CSS 4 + shadcn/ui** for the dashboard
- **LRU cache** (in-memory) for image bytes + metadata
- **file-type** for magic-byte MIME detection
- **zod** for request validation

## Setup

### 1. Environment

Copy `.env.example` → `.env` and fill in:

```bash
# Telegram (from https://my.telegram.org → API development tools)
TELEGRAM_API_ID=123456
TELEGRAM_API_HASH=abc...hash
# Generate with: openssl rand -hex 32
TELEGRAM_SESSION_KEY=...64 hex chars...
# Generate with: openssl rand -hex 32 (min 32 chars)
AUTH_SECRET=...64 hex chars...

ADMIN_EMAIL=admin@growplants.in
ADMIN_PASSWORD=Admin@123456   # change in production

APP_URL=https://storage.growplants.in
MAX_IMAGE_SIZE_MB=20
```

### 2. Database

```bash
bun install
bun run db:push
```

### 3. Run dev

```bash
bun run dev
```

Open `http://localhost:3000` → redirects to `/login`.
Login with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

### 4. Connect Telegram

1. Go to **Settings**.
2. Enter phone number (international format, e.g. `+91 98765 43210`).
3. Click **Send Code** — Telegram sends an OTP via SMS/app.
4. Enter the code. If 2FA is enabled, enter your Telegram 2FA password.
5. Status becomes **Connected**. The session is AES-256-GCM encrypted at rest in the DB.

### 5. Register a Storage Channel

1. Create a private channel in your Telegram app (e.g. "🌿 GrowPlants Storage").
2. Find its channel ID (looks like `-1001234567890`). Tools: `@GetIDs Bot`, Telegram web message link, etc.
3. Go to **Storage Channels** → **+ Add Channel**.
4. Enter display name, channel ID, and purpose.
5. The backend tests access (send + delete a test message). On success, the channel is registered.

### 6. Upload an Image

1. Go to **Upload**.
2. Select a storage destination.
3. Drop or pick an image (JPEG / PNG / WEBP / GIF, max 20 MB by default).
4. Click **Upload**. Progress bar shows upload to Telegram.
5. On success, you get a stable URL like `https://storage.growplants.in/i/gp_x82ka91`.
6. **Copy** the URL and paste it into the GrowPlants Admin Panel product image field.

### 7. Embed in GrowPlants

GrowPlants stores the URL as a normal string. The website renders `<img src="https://storage.growplants.in/i/gp_x82ka91">`. The browser hits our `/i/:publicId` route, which streams the image bytes from our cache (hot) or from Telegram (cold, then cached).

## Public URL Behavior

- `/i/:publicId` is **public**, no auth required.
- Returns image bytes with `Content-Type`, `Content-Length`, `ETag`, `Cache-Control: public, max-age=86400, immutable`.
- 404 if `publicId` not found or file status is not `active`.
- 410 if file was soft-deleted (deliberately distinguished from 404).
- 502 if Telegram is unreachable.
- Stale `fileReference` (Telegram rotates every few days) is automatically refreshed on cache miss.
- Image bytes are cached in memory for 7 days (configurable).

## Security

- Telegram `api_id` / `api_hash` / `session` are **server-side only**, never sent to the browser.
- The Telegram StringSession is **AES-256-GCM encrypted** at rest with `TELEGRAM_SESSION_KEY`.
- Admin password is **bcrypt-hashed** (cost 12).
- Session cookie is `httpOnly` + `SameSite=Lax`.
- All admin APIs (`/api/files`, `/api/channels`, `/api/telegram`) require valid session.
- Public `/i/:publicId` is the only unauthenticated endpoint (intentionally).
- File uploads validate MIME via **magic bytes**, not extension.
- File size is enforced both at the request boundary and via streaming.
- Rate limits: 30 uploads/min/admin, 5 login attempts/15min/IP, 600 req/min/IP for public image endpoint.
- Audit log records every login, upload, delete, channel op, telegram event. Secrets are never logged.
- Security headers: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS in production.

## Phases Status

| Phase | Scope | Status |
|-------|-------|--------|
| A | Foundation (auth, DB, dashboard shell, health) | ✅ Done |
| B | Telegram (GramJS, encrypted session, multi-step connect) | ✅ Done |
| C | Channels (CRUD, test endpoint, management UI) | ✅ Done |
| D | Upload (FileService, MIME validation, Telegram upload, UI) | ✅ Done |
| E | Stable URLs (publicId, /i/:publicId, file-reference refresh, streaming, cache) | ✅ Done |
| F | File Management (grid, search, filters, copy, delete) | ✅ Done |
| G | Performance & Hardening (rate limits, security headers, audit, dashboard stats) | ✅ Done |
| H | Deployment (Docker, .env.example, README, health check) | ✅ Done |

## API Reference

### Auth
- `POST /api/auth/callback/credentials` (login)
- `GET /api/auth/session-status`
- `POST /api/auth/signout` (logout)

### Telegram
- `POST /api/telegram/connect/request-code` `{ phone }` → `{ phoneCodeHash }`
- `POST /api/telegram/connect/verify-code` `{ phone, code, phoneCodeHash }` → `{ needs2fa }`
- `POST /api/telegram/connect/verify-2fa` `{ password }`
- `POST /api/telegram/disconnect`
- `GET /api/telegram/status`

### Channels (auth required)
- `GET /api/channels` — list
- `POST /api/channels` `{ name, telegramChannelId, purpose? }` — register
- `GET /api/channels/:id`
- `PATCH /api/channels/:id` `{ name?, purpose?, status? }`
- `DELETE /api/channels/:id` — removes DB row only (Telegram content untouched)
- `POST /api/channels/:id/test` — verifies access by sending + deleting a test message

### Files (auth required)
- `GET /api/files?search=&channelId=&status=&page=&limit=`
- `POST /api/files/upload` (multipart: `file` + `storageChannelId`)
- `GET /api/files/:id` — `id` can be numeric DB id or publicId
- `DELETE /api/files/:id` — soft delete + cache invalidate + Telegram delete attempt

### Public (no auth)
- `GET /i/:publicId` — returns image bytes with caching headers
- `GET /api/health` — `{ db, telegram, cache }`

## Production Deployment

### Docker

```dockerfile
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

FROM oven/bun:1 AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["bun", ".next/standalone/server.js"]
```

### Required

- Set all env vars via your secret manager (never commit `.env`).
- Set up TLS termination (Caddy, nginx, Cloudflare, etc.) — `APP_URL` must be HTTPS.
- Mount a persistent volume for the SQLite DB.
- Set up daily `pg_dump`-equivalent for SQLite (`sqlite3 db/custom.db .backup`).
- Monitor `/api/health`.

## Backup Strategy

The database holds the `publicId → telegramMessageId` mapping. If it's lost, public URLs stop working even if Telegram files still exist. **Back up the SQLite DB daily.**

Telegram content is preserved across redeploys (it lives in your Telegram account). But if the admin deletes the channel in Telegram, all files mapped to it 404.

## Limitations / Risks

- Telegram's terms of service are intended for messaging. Using a personal account as storage at scale is grey-area. For low-volume single-admin use (e.g. product images), risk is low but non-zero. Always back up the database.
- `fileReference` rotates every ~1–7 days. Our backend auto-refreshes it on cache miss, but the first cold request after expiry will take ~1 extra second.
- The GramJS session grants full account control if leaked. It's encrypted at rest — protect `TELEGRAM_SESSION_KEY`.
- V1 file size cap is 20 MB by default (configurable via `MAX_IMAGE_SIZE_MB`). Telegram's MTProto limit is 2 GB.
- V1 supports single-file uploads (no bulk).
- V1 does not optimize images (original bytes are stored and served).

## License

Private. Single-admin deployment.
