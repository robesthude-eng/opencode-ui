# OpenCode UI – Full Modernization Plan
_Status: **COMPLETE** (code) — audit-fixed 2026-07-10 · v0.3.1_

**Stack:** React 19.2 · Vite 7 · Tailwind 4 · shadcn · TanStack Router · Zustand+idb · Biome · React Compiler · PWA · Vitest · Playwright · better-sqlite3 · pino · Sentry · Node 22

---

## ✅ All planned phases done

| Phase | Deliverable |
|---|---|
| 1 Core | React 19.2, drop http-proxy, sandbox `src/**`, CI, 0 vulns |
| 2 UI | Tailwind 4 + shadcn, `styles.css` deleted, typography + highlight |
| 3 DX | Biome hard gate, React Compiler, PWA + icons |
| 4/5 Quality | 115+ tests, e2e-local always-on, optional e2e-prod |
| 6 Security | SQLite auth, HttpOnly cookie, CSRF, rate-limit, pepper, CSP for Sentry/PWA |
| 7 Frontend | TanStack Router, persist, markdown highlight |
| 8/9 Ops | Sandbox Biome→tsc→vitest→vite, instant dist rollback (+ boot snapshot), DB backups download/webhook, Sentry, health admin UI |

## Audit fixes (this pass)

- [x] CSP `connect-src` allows `https:` (Sentry) + `worker-src` (PWA)
- [x] SELF_IMPROVE guides updated (no Prettier / no styles.css / cookie auth)
- [x] PWA icons `public/icon-192.png`, `icon-512.png`
- [x] `index.html` version stamp v18.1
- [x] Boot-time `promoteDistSnapshot()` so instant rollback has a baseline
- [x] Factory workspace-src includes public/, biome, vitest, guides
- [x] `.dockerignore` no longer strips `*.md` / needed docs from image context incorrectly for workspace-src

## Human checklist (you)

1. [ ] **Revoke** GitHub PAT + Railway token from chat  
2. [ ] Set Railway `OPENCODE_PASSWORD_PEPPER`  
3. [ ] (opt) `SENTRY_DSN` + build-time `VITE_SENTRY_DSN`  
4. [ ] (opt) `PLAYWRIGHT_BASE_URL` + e2e secrets  
5. [ ] (opt) `BACKUP_WEBHOOK_URL`  

## Intentionally deferred

| Item | Why |
|---|---|
| better-auth rewrite | SQLite + cookies solid enough |
| Full pnpm | npm stable on Railway |
| Alpine prod-only deps | self-improve needs toolchain |
| S3 backup push | webhook + download cover pull model |

## Admin recovery

1. Instant UI rollback → 2. Git rollback → 3. Factory reset  
4. DB backup/download before risky ops  

See `docs/OPS.md`, `SECURITY.md`.

**Production:** https://opencode-ui-production.up.railway.app
