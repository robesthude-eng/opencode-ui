# OpenCode UI – Full Modernization Plan
_Status: **COMPLETE** (code) — 2026-07-10 · v0.3.0_

**Stack:** React 19.2 · Vite 7 · Tailwind 4 · shadcn · TanStack Router · Zustand+idb · Biome · React Compiler · PWA · Vitest · Playwright · better-sqlite3 · pino · Sentry · Node 22

---

## ✅ All planned phases done

| Phase | Deliverable |
|---|---|
| 1 Core | React 19.2, drop http-proxy, sandbox `src/**`, CI, 0 vulns |
| 2 UI | Tailwind 4 + shadcn, `styles.css` deleted, typography + highlight |
| 3 DX | Biome hard gate, React Compiler, PWA |
| 4/5 Quality | 114+ tests, e2e-local always-on, optional e2e-prod |
| 6 Security | SQLite auth, HttpOnly cookie, CSRF, rate-limit, pepper |
| 7 Frontend | TanStack Router, persist, markdown highlight |
| 8/9 Ops | Sandbox Biome→tsc→vitest→vite, instant dist rollback, DB backups + download, Sentry browser+server, health admin UI, webhook hook for off-site |

## Human checklist (after this push)

1. [ ] **Revoke** GitHub PAT + Railway token that appeared in chat  
2. [ ] Set Railway `OPENCODE_PASSWORD_PEPPER`  
3. [ ] (opt) `SENTRY_DSN` + build-time `VITE_SENTRY_DSN`  
4. [ ] (opt) `PLAYWRIGHT_BASE_URL` + e2e secrets  
5. [ ] (opt) `BACKUP_WEBHOOK_URL` for off-site notify  

## Intentionally not done (documented trade-offs)

| Item | Why deferred |
|---|---|
| better-auth rewrite | Large; SQLite layer + scrypt + cookies already solid |
| Full pnpm lockfile | Railway/Docker path is npm-stable; `packageManager` ready |
| Alpine / prod-only node_modules | Self-improve needs full toolchain in image |
| S3 push of backups | Webhook + download API cover “pull” model |

## Admin recovery (product)

1. Instant UI rollback → 2. Git rollback → 3. Factory reset  
4. DB backup/download before risky ops  

See **`docs/OPS.md`** and **`SECURITY.md`**.

## Metrics

| | |
|---|---|
| Version | **0.3.0** |
| Tests | **114+** |
| CI | lint · audit · unit · build · e2e-local |
| Auth | SQLite + cookie + optional pepper |
| Observability | pino + optional Sentry |
| Backups | daily + manual + download + webhook |

## Changelog (final stretch)

- `b95b077` – e2e CI, SQLite backups, Sentry stub, SECURITY.md  
- `dca80d4` – admin health + instant rollback UI  
- *(this)* – real Sentry packages, backup download, webhook, OPS.md, plan closed  

**Production:** https://opencode-ui-production.up.railway.app
