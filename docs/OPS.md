# Operations guide — OpenCode UI

## Deploy

- **GitHub** `main` → Timeweb VDS deploy (Docker Compose)
- Health: `GET /health` → `{ status: "ok", opencode: "healthy", uptime }`
- URL: `the configured Timeweb HTTPS domain (when available)`

## Timeweb environment variables (recommended)

| Variable | Purpose |
|---|---|
| `OPENCODE_ZEN_API_KEY` | Free models via OpenCode Zen |
| `OPENCODE_ADMIN_EMAILS` | Always-admin emails (comma-separated) |
| `OPENCODE_PASSWORD_PEPPER` | HMAC pepper for password hashes |
| `OPENCODE_WORKDIR` | Default `/app/workspace` (volume) |
| `SENTRY_DSN` | Server error reporting |
| `VITE_SENTRY_DSN` | Browser errors (**rebuild required** — Vite bakes at build time) |
| `BACKUP_WEBHOOK_URL` | Notify external system after DB backup |
| `BACKUP_WEBHOOK_TOKEN` | Optional bearer for webhook |
| `LOG_LEVEL` | pino level (`info` default in prod) |
| `NODE_ENV` | `production` |

> **Note:** `VITE_*` vars must be available at **Docker build** time for the frontend bundle. Set them as Docker build args / build-time environment if needed.

## Admin UI (Settings → Саморазвитие)

1. **Health** — UI proxy + OpenCode + uptime
2. **DB backup** — create / list / **download**
3. **Instant UI rollback** — previous dist snapshot
4. **Git checkpoint / rollback / rebuild / factory reset**
5. **Audit console**

## CI

| Job | When |
|---|---|
| `test` | lint + audit + unit + build |
| `e2e-local` | always — Playwright vs `vite preview` |
| `e2e-prod` | if `vars.PLAYWRIGHT_BASE_URL` set |

Optional secrets for prod e2e: `E2E_EMAIL`, `E2E_PASSWORD`.

## Backup & restore

- Files: `$OPENCODE_WORKDIR/backups/opencode-*.db`
- Create: admin UI or `POST /api/db/backup`
- Download: `GET /api/db/backups/<name>` (admin cookie)
- Restore (manual on volume): stop app → replace `opencode.db` with backup → start

## After you finish development

1. Revoke exposed GitHub PAT and Timeweb API token (see `SECURITY.md`)
2. Set `OPENCODE_PASSWORD_PEPPER`
3. Optionally wire Sentry DSNs
4. Optionally set `PLAYWRIGHT_BASE_URL` for prod e2e

## What we intentionally deferred

- **better-auth** full rewrite — current SQLite layer is production-capable
- **pnpm** full migration — npm lockfile kept for Docker/Timeweb simplicity; `packageManager` field set
- **Alpine slim image without devDeps** — conflicts with self-improve sandbox needing tsc/vitest/vite
