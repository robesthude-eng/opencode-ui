# OpenCode UI – Full Modernization Plan
_Last updated: 2026-07-10 – backlog execution (Biome hard gate, sandbox, dist rollback, slim Docker)_

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
- Vitest **110+ tests**, coverage script
- Playwright smoke + auth-chat specs
- Dependabot, npm audit in CI
- **Biome hard gate** in CI (`npm run lint` must pass)

## ✅ Phase 6 – Security
- **SQLite** auth store (`opencode.db`) via better-sqlite3; auto-migrates legacy JSON
- **HttpOnly cookie** `opencode_session` only
- **CSRF** Origin/Referer for cookie-authenticated mutations
- **Per-user rate limit** on heavy endpoints
- Structured logs (**pino**)
- **Password pepper** via `OPENCODE_PASSWORD_PEPPER` (v2 hashes + legacy verify)

## ✅ Phase 7 – Frontend modern
- **TanStack Router** – `/`, `/chat/$sessionId`
- **Zustand persist** – theme, sidebar, workspace, last model → IndexedDB
- Markdown syntax highlighting

## ✅ Phase 8/9 – Ops / self-improve
- Sandbox pipeline: **Biome → tsc → vitest → vite build**
- **Instant dist rollback**: snapshots in `/app/dist-versions` (last 3), APIs:
  - `GET /api/dist/snapshots`
  - `POST /api/dist/instant-rollback` `{ index?: number }`
- Slimmer multi-stage Docker (`npm prune --omit=dev` runtime)
- Optional Sentry stub (`src/lib/sentry.ts`, `VITE_SENTRY_DSN`)

## ⏳ Remaining backlog
- [ ] Full Playwright suite always-on in CI (needs secrets/vars)
- [ ] better-auth full rewrite (beyond SQLite compatibility layer)
- [ ] Sentry packages installed + wired when DSN present
- [ ] pnpm migration
- [ ] **Rotate leaked GitHub PAT + Railway token** (URGENT – human action)

---

## Metrics

| Metric | Now |
|---|---|
| Tests | **110+** |
| Auth storage | **SQLite** |
| Session | **HttpOnly cookie only** |
| Sandbox gates | Biome + tsc + vitest + vite build |
| Dist rollback | instant snapshots (≤3) |
| Biome CI | **hard gate** |
| Logs | pino |
| Password pepper | optional env |

---

## Changelog (recent)
- `ea7cb24` – finish Tailwind, delete styles.css
- `89be913` – HttpOnly cookie + CSRF + CI quality
- `c6aad43` – SQLite, router, cookie-only, highlight, persist, pino, rate-limit
- *(this)* – Biome hard gate, sandbox biome+vite build, instant dist rollback, pepper, slim Docker, e2e auth-chat, Sentry stub

**Deploy:** push `main` → Railway → https://opencode-ui-production.up.railway.app
