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
| `TRUSTED_PROXY_IPS` | Exact comma-separated proxy socket IPs allowed to set `X-Forwarded-*` headers |
| `SENTRY_DSN` | Server error reporting |
| `VITE_SENTRY_DSN` | Browser errors (**rebuild required** — Vite bakes at build time) |
| `BACKUP_WEBHOOK_URL` | Notify external system after DB backup |
| `BACKUP_WEBHOOK_TOKEN` | Optional bearer for webhook |
| `LOG_LEVEL` | pino level (`info` default in prod) |
| `RATE_LIMIT_REDIS_URL` | Shared `redis://` / `rediss://` endpoint for all UI instances |
| `RATE_LIMIT_REDIS_PREFIX` | Key namespace, default `opencode-ui:rate-limit:` |
| `RATE_LIMIT_REDIS_TIMEOUT_MS` | Redis connection timeout, default 1000 ms |
| `SI_BIOME_TIMEOUT_MS` | Sandbox Biome timeout (default 60000) |
| `SI_TSC_TIMEOUT_MS` | Sandbox TypeScript timeout (default 120000) |
| `SI_VITEST_TIMEOUT_MS` | Sandbox Vitest timeout (default 180000) |
| `SI_VITE_TIMEOUT_MS` | Sandbox Vite build timeout (default 300000) |
| `SI_NPM_INSTALL_TIMEOUT_MS` | Self-improve npm install timeout (default 300000) |
| `SI_VITE_BUILD_TIMEOUT_MS` | Self-improve rebuild timeout (default 600000) |
| `NODE_ENV` | `production` |

> **Note:** `VITE_*` vars must be available at **Docker build** time for the frontend bundle. Set them as Docker build args / build-time environment if needed.


## Shared rate limiting and horizontal scale

`docker compose up` starts a private Redis service and configures the UI to use it. For replicas running on separate hosts, point every replica at one managed Redis instance through `RATE_LIMIT_REDIS_URL`; use `rediss://` where the provider requires TLS. Login/registration attempts, user/IP limits, uploads, and heavy self-improvement operations all use the same atomic Redis fixed-window counter. Successful authentication deletes the corresponding shared login-attempt key. The service fails closed with HTTP 503 when an explicitly configured Redis limiter cannot be reached, preventing a silent loss of global throttling during an outage. Redis data is deliberately not persisted: limiter keys have short TTLs and are not application data.

## Reverse proxy trust boundary

Leave `TRUSTED_PROXY_IPS` unset when the application port is exposed directly. When TLS termination or ingress is used, set it to the **exact socket peer IP** of the proxy (for example `127.0.0.1,::1` for a local Nginx). Do not use `0.0.0.0/0`, Docker subnet ranges, or public CIDRs: those would let an untrusted peer forge `X-Forwarded-For`. The server accepts `X-Forwarded-For`, `X-Forwarded-Host`, and `X-Forwarded-Proto` only from this allowlist.

## Admin UI (Settings → Саморазвитие)

1. **Health** — UI proxy + OpenCode + uptime
2. **DB backup** — create / list / **download**
3. **Instant UI rollback** — previous dist snapshot
4. **Git checkpoint / rollback / rebuild / factory reset**
5. **Audit console**

## CI

| Job | When |
|---|---|
| `test-and-build` | Biome + TypeScript + Vitest coverage threshold + build |
| `e2e-local` | always — Playwright vs `vite preview` |
| `e2e-mock` | always after build — production proxy + deterministic OpenCode mock + Chromium |
| `e2e-prod` | if `vars.PLAYWRIGHT_BASE_URL` set |

Optional secrets for prod e2e: `E2E_EMAIL`, `E2E_PASSWORD`.

`npm run lint` (Biome check) is an enforced step inside `test-and-build` — it fails the build on any formatting/lint drift.

`npm run test:coverage:ci` enforces the current global baseline: **20%** for lines, statements, and functions, plus **15%** for branches. CI publishes the `coverage/` directory (HTML report, LCOV, and JSON summary) as a 14-day artifact on every run, including a failed threshold run. Raise the baseline deliberately as the test suite grows.

### One-time Biome formatting (manual)

`.github/workflows/biome-format-once.yml` is a manual (`workflow_dispatch`-only) job, not run on push/PR. Trigger it from Actions → "Biome one-time format" → Run workflow when the repo needs a bulk `npm run check` pass (e.g. right after re-enabling the enforced lint step, or after a large refactor). It commits the formatted diff to a new branch and opens a PR for review — it never pushes directly to `main`. Delete the workflow file once it's no longer needed; it isn't part of the standing CI pipeline.

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
