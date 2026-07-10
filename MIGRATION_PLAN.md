# OpenCode UI – Full Modernization Plan
_Last updated: 2026-07-10 – full stack migration complete_

**Stack (2026 production baseline):**
React 19.2 · Vite 7 · Tailwind CSS 4 · shadcn/ui (Radix) · TanStack Router · Zustand persist (idb) · Biome · React Compiler · PWA · Vitest + Playwright · better-sqlite3 · pino · Node 22

---

## ✅ Phase 1 – Core stack & security
- React 19.2, react-markdown 10, zustand 5, drop http-proxy, sandbox `src/**` only, CI, 0 vulns

## ✅ Phase 2 – Tailwind / shadcn (complete)
- Tailwind 4 + shadcn primitives, all components migrated, `styles.css` **deleted**
- `@tailwindcss/typography` + `rehype-highlight` (github-dark)

## ✅ Phase 3 – DX
- Biome, React Compiler, PWA, path alias `@/*`

## ✅ Phase 4/5 – Quality
- Vitest **110 tests**, coverage script, Playwright smoke e2e scaffold
- Dependabot, npm audit in CI, Biome soft gate

## ✅ Phase 6 – Security
- **SQLite** auth store (`opencode.db`) via better-sqlite3; auto-migrates legacy JSON
- **HttpOnly cookie** `opencode_session` only (no token in localStorage)
- **CSRF** Origin/Referer for cookie-authenticated mutations
- **Per-user rate limit** on heavy endpoints
- Structured logs (**pino**)

## ✅ Phase 7 – Frontend modern
- **TanStack Router** – `/`, `/chat/$sessionId`
- **Zustand persist** – theme, sidebar, workspace, last model → IndexedDB (idb-keyval)
- Markdown syntax highlighting (rehype-highlight)

## ⏳ Remaining backlog
- [ ] Hard Biome CI gate (clean ~186 legacy diagnostics)
- [ ] Playwright full critical-path suite in CI
- [ ] better-auth / password pepper / full SQLite query API (beyond compatibility layer)
- [ ] Sentry, multi-stage slim Docker runtime without devDeps
- [ ] pnpm migration
- [ ] Instant dist rollback / sandbox vite build gate
- [ ] **Rotate leaked GitHub PAT + Railway token** (URGENT – human action)

---

## Metrics

| Metric | Now |
|---|---|
| Tests | **110** |
| Auth storage | **SQLite** (`opencode.db`) |
| Session | **HttpOnly cookie only** |
| Router | TanStack Router |
| CSS | Tailwind only |
| Logs | pino |
| Rate limit | per-user heavy endpoints |

---

## Changelog (recent)
- `ea7cb24` – finish Tailwind, delete styles.css
- `89be913` – HttpOnly cookie + CSRF + CI quality
- *(this commit)* – SQLite auth, cookie-only, TanStack Router, rehype-highlight, zustand persist, pino, rate-limit, Playwright, Dockerfile native build deps

**Deploy:** push `main` → Railway auto-deploy → https://opencode-ui-production.up.railway.app
