# OpenCode UI – Full Modernization Plan
_Last updated: 2026-07-10 – ops: e2e CI, SQLite backups, Sentry-ready, admin UX_

**Stack (2026 production baseline):**
React 19.2 · Vite 7 · Tailwind CSS 4 · shadcn/ui · TanStack Router · Zustand persist · Biome · React Compiler · PWA · Vitest + Playwright · better-sqlite3 · pino · Node 22

---

## ✅ Completed phases 1–9 (summary)

| Area | Status |
|---|---|
| Core stack / security sandbox | ✅ |
| Tailwind + shadcn full UI | ✅ (`styles.css` deleted) |
| Biome hard CI gate | ✅ |
| SQLite auth + cookie sessions + CSRF | ✅ |
| TanStack Router + persist + highlight | ✅ |
| Sandbox: Biome → tsc → vitest → vite build | ✅ |
| Instant dist rollback + admin UI | ✅ |
| Admin health panel | ✅ |
| Password pepper (optional) | ✅ |
| **Playwright e2e-local always-on in CI** | ✅ |
| **SQLite backups (daily + admin manual)** | ✅ |
| **Sentry-ready (optional DSN)** | ✅ |
| SECURITY.md | ✅ |

## ⏳ Remaining backlog

- [ ] **Rotate leaked GitHub PAT + Railway token** (URGENT – human only)
- [ ] Set `OPENCODE_PASSWORD_PEPPER` in Railway
- [ ] Optional: `PLAYWRIGHT_BASE_URL` + `E2E_*` secrets for prod e2e job
- [ ] Optional: `npm i @sentry/react` + `VITE_SENTRY_DSN` for real Sentry
- [ ] better-auth full rewrite (large; not required for current SQLite layer)
- [ ] pnpm migration (packageManager field prepared; lockfile still npm)
- [ ] Off-site backup upload (S3/R2) for `backups/*.db`
- [ ] Slimmer runtime image without full devDeps (trade-off vs self-improve)

---

## Admin runbook (product)

1. **Health** — Settings → Саморазвитие → top cards  
2. **Broken UI after agent** — Instant rollback (needs ≥2 builds)  
3. **Need source history** — Git checkpoint / Git rollback  
4. **Before risky change** — Create DB backup + Git checkpoint  
5. **Nuclear** — Factory reset  

APIs:  
`GET /api/dist/snapshots` · `POST /api/dist/instant-rollback` ·  
`GET /api/db/backups` · `POST /api/db/backup`

---

## Metrics

| Metric | Now |
|---|---|
| Version | **0.3.0** |
| Tests | **112+** (+ backup unit) |
| CI | lint · audit · unit · build · **e2e-local** |
| Auth DB | SQLite + daily backups |
| Session | HttpOnly cookie only |

---

## Changelog (recent)

- `c6aad43` – SQLite, router, cookie-only, highlight, persist, pino  
- `85637ea` – Biome hard gate, sandbox vite, instant dist rollback  
- `dca80d4` – Admin health + instant rollback UI  
- *(this)* – e2e-local CI, SQLite backup API/UI/scheduler, Sentry-ready, SECURITY.md  

**Deploy:** https://opencode-ui-production.up.railway.app
