# OpenCode UI – Full Modernization Plan
_Last updated: 2026-07-10 – Phase 2b done + Phase 6 cookie auth started_

This document tracks the ongoing migration to latest technologies. Use it as a checklist for the self-improvement agent and human contributors.

**Stack target (world-class 2026 baseline):**
React 19.2 · Vite 7 · Tailwind CSS 4 · shadcn/ui (Radix) · Biome · React Compiler · PWA · Vitest · Node 22

---

## ✅ Completed – Phase 1: Core stack & security (2026-07-10)

### Dependencies
- [x] React 19.1 → **19.2.7**
- [x] react-dom 19.1 → 19.2.7
- [x] react-markdown 9.0.1 → **10.1.0** (React 19 compat)
- [x] zustand 5.0.3 → **5.0.14**
- [x] remark-gfm 4.0.0 → 4.0.1
- [x] Remove `http-proxy@1.18.1` (unmaintained, CVE history)
  → replaced with native Node http reverse proxy, 80 LOC, `server/index.mjs`
  - HTTP + WebSocket + SSE support preserved
  - 0 external deps for proxying
- [x] npm audit: **0 vulnerabilities**
- [x] Commit `package-lock.json` – reproducible builds
- [x] Dockerfile: `npm install` → `npm ci`

### Self-improve sandbox hardening
- [x] Sandbox allowlist: **only `src/**` editable**
  - Blocked: `package.json`, `package-lock.json`, `server/**`, `vite.config.ts`, `tsconfig*`, `index.html`, `Dockerfile`, `railway.json`, `.github/**`
  - Prevents RCE via npm postinstall
- [x] Pipeline: **Prettier → tsc -b → vitest run**
  - Deploy blocked on test failures (`status: "tests_failed"`)
- [x] Auto-correct attempts: 1 → **2**
- [x] Audit logging preserved
- [x] Updated `SELF_IMPROVE_GUIDE.md`

### CI / DevOps
- [x] GitHub Actions CI: `.github/workflows/ci.yml`
  - Node 22, `npm ci`, `test:all`, `build`, upload dist artifact
- [x] Railway deployment: production SUCCESS
  - URL: `opencode-ui-production.up.railway.app`

### Tests
- [x] 96 tests passing (Vitest 4.1.10)
  - src/__tests__: 11 + 8 + 8 + 15 = 42
  - server/__tests__: 10 + 5 + 9 + 5 + 1 + 1 = 31
  - + helpers, etc. = 96 total

---

## ✅ Completed – Phase 2a: Tailwind / shadcn foundation (2026-07-10)

- [x] Tailwind CSS **4.x** + `@tailwindcss/vite`
- [x] shadcn/ui deps:
  - `tailwind-merge`, `clsx`, `class-variance-authority`
  - `lucide-react`, `tw-animate-css`
  - `@radix-ui/react-slot` + dialog / tabs / switch / label / scroll-area / select / separator / tooltip / dropdown-menu
- [x] Path alias `@/*` → `./src/*` (tsconfig + vite + vitest)
- [x] `src/index.css` – Tailwind entry + design tokens matching dark UI
  - colors: background #0b0b0f, card #14141c, primary #7c5cff, etc.
  - radius: 0.75rem
- [x] UI primitives in `src/components/ui/`:
  - `button`, `input`, `textarea`, `card`, `badge`, `dialog`, `tabs`, `switch`, `label`, `scroll-area`, `separator`
- [x] `src/main.tsx` imports `./index.css` before `./styles.css` – gradual migration
- [x] `@tailwindcss/typography` for markdown (`prose prose-invert`)

---

## ✅ Completed – Phase 3: DX tooling (2026-07-10)

- [x] **Biome 2.5.3** – replaces Prettier+ESLint
  - `npm run lint` / `format` / `check`
  - 2-space indent, 100 col, organizeImports on
  - config: `biome.json`
- [x] **React Compiler 19.1.0-rc.2**
  - `babel-plugin-react-compiler` in `vite.config.ts`
  - Graceful degrade if not installed (local Node 20)
  - Auto-memoization, reduces useMemo/useCallback need
- [x] **PWA – vite-plugin-pwa 1.0.3**
  - Manifest: OpenCode UI, standalone, theme #0b0b0f
  - Workbox: navigateFallback `/index.html`
  - Runtime caching: `/api/*` NetworkFirst, 3s timeout
  - Gracefully degrades if plugin missing
  - TODO: add real icons `/public/icon-192.png`, `/public/icon-512.png` (manifest currently 404s)
- [x] Vite config made resilient: optional deps try/catch, TypeScript-safe

---

## 🔄 In Progress – Phase 2b: Tailwind component migration

Goal: migrate all `src/components/*.tsx` + shell layout from legacy `styles.css` to Tailwind + shadcn, then delete `src/styles.css` (~56 KB / ~2300 LOC).

### 2b.1 – Composer ✅ DONE – commit `69e4148`
- [x] `src/components/Composer.tsx` – shadcn Button, Tailwind chips / progress

### 2b.2 – Primitives ✅ DONE (this batch)
- [x] `src/components/CopyButton.tsx` → shadcn Button ghost/icon + lucide
- [x] `src/components/Skeleton.tsx` → Tailwind `animate-pulse`
- [x] `src/components/icons.tsx` – kept as lightweight custom SVG set (tool icons + brand); lucide used where a generic icon fits (Copy/Check/etc.)

### 2b.3 – Sidebar ✅ DONE – commit `1b8523d`
- [x] `src/components/Sidebar.tsx` – Button, ScrollArea, Badge, Separator, mobile drawer pattern

### 2b.4 – Chat view ✅ DONE – commits `256d114` + this batch
- [x] `src/components/ChatView.tsx`
- [x] `src/components/MessageItem.tsx`
- [x] `src/components/PartView.tsx` – markdown + attachment + reasoning (Tailwind + prose)
- [x] `src/components/ToolCard.tsx` – default + question tool cards
- [x] `src/components/ToolGroup.tsx`
  - Markdown: `react-markdown` + `remark-gfm` + `@tailwindcss/typography`
  - Streaming cursor, tool call expand/collapse preserved

### 2b.5 – Top bar ✅ DONE – commit `d61497c`
- [x] `src/components/TopBar.tsx`
- [x] `src/components/ModelSelector.tsx`

### 2b.6 – Settings / Auth ✅ DONE (Settings earlier; Auth this batch)
- [x] `src/components/SettingsPanel.tsx` – commit `4d5c960` (tests updated)
  - Keep test-compatible strings + `.overlay` class for tests
  - shadcn: Button, Input, Switch, Tabs, Dialog primitives
- [x] `src/components/LoginPage.tsx` – Card, Input, Button, Label, Tabs-like switcher
- [x] `src/components/PermissionDialog.tsx` – Dialog + Button
- [x] `src/components/ErrorBoundary.tsx` – Card + Button

### 2b.7 – Workspace + shell ✅ DONE (this batch)
- [x] `src/components/Workspace.tsx` – file tree, git status, upload, viewer overlay
- [x] `src/App.tsx` – Tailwind layout shell (no `.app` / `.main` CSS grid dependency)
  - Desktop: flex row — Sidebar | main | Workspace
  - Mobile: fixed Sidebar drawer (already in Sidebar)
  - Connection banner + reveal sidebar button

### 2b.8 – Cleanup ✅ DONE (this batch)
- [x] Delete `src/styles.css` (~56 KB, ~2300 LOC)
- [x] Remove legacy CSS import from `src/main.tsx`
- [x] Minimal global base moved into `src/index.css` (html/body/#root layout, scrollbar)
- [x] Verify build + tests still pass
- [ ] Visual regression – Playwright screenshots (Phase 5)
- [ ] Update `SELF_IMPROVE.md` – remove old CSS references (if any remain)

**shadcn components installed / present:**
- button, input, textarea, card, badge, dialog, tabs, switch, label, scroll-area, separator

**Still optional (Phase 7):**
- dropdown-menu, select, sheet, skeleton (as ui/*), tooltip, alert
- react-hook-form + zod for LoginPage
- shiki / rehype-highlight for code blocks

---

## ⏳ Planned – Phase 4: Package manager & build

- [ ] **pnpm migration**
  - `pnpm import` (converts package-lock.json)
  - Update `package.json`: `"packageManager": "pnpm@10.x"`
  - Update Dockerfile: `npm ci` → `pnpm install --frozen-lockfile`
  - Update GitHub Actions: `setup-node {cache: 'pnpm'}`, `pnpm install`
  - Expected: install 3× faster, image ~15% smaller
  - Risk: low – lockfile is deterministic
- [ ] **Turborepo** (optional, if project splits into `apps/web`, `apps/server`, `packages/ui`)
  - Not needed yet – single package
  - Defer until >2 packages

---

## ⏳ Planned – Phase 5: Testing & quality

- [ ] **Playwright E2E**
  ```
  npm install -D @playwright/test
  npx playwright install
  ```
  - Test files: `e2e/auth.spec.ts`, `e2e/chat.spec.ts`, `e2e/self-improve.spec.ts`
  - CI: run on PR, upload trace on failure
  - Critical paths:
    1. Login → new chat → send message → receive streaming response
    2. Upload file → attachment chip appears → send with attachment
    3. Admin → Settings → Self-improve toggle → sandbox dry-run
    4. Visual regression: Composer, Sidebar, ChatView screenshots
- [ ] **Vitest coverage**
  - Current: **106 tests**, no coverage threshold
  - Add: `"test:coverage": "vitest run --coverage"`
  - Target: >70% statements for `src/api/`, `src/store/`
  - Add: `npm install -D @vitest/coverage-v8`
- [x] **Biome CI gate (soft)** – `npm run lint` in CI with `continue-on-error: true`
  - [ ] Make hard gate after cleaning ~186 existing Biome diagnostics
- [x] **npm audit in CI** – fail on high/critical
- [x] **Dependabot** – `.github/dependabot.yml` weekly npm + actions
- [ ] **TypeScript strict mode – full**
  - Currently: `noUnusedLocals: false`, `noUnusedParameters: false`
  - Enable both, fix warnings
  - Add `"noUncheckedIndexedAccess": true`

---

## ⏳ Planned – Phase 6: Security hardening

Priority: HIGH – do before public multi-tenant launch.

- [ ] **Auth storage – JSON → SQLite**
  - Current: `.users.json`, `.sessions.json`, `.session_owners.json` in Railway Volume
  - Risk: no ACID, race conditions on concurrent writes, no password pepper
  - Migrate to: `better-auth` + `better-sqlite3`
  - Files: `server/auth.mjs` → rewrite
  - Migration script: JSON → SQLite on first boot
  - Keep scrypt password hashes – compatible
- [x] **Session tokens – HttpOnly cookie (primary) + transitional header**
  - Cookie: `opencode_session`; `HttpOnly; SameSite=Lax; Secure` (prod/Railway)
  - Login/register set `Set-Cookie`; logout clears it
  - Server `extractToken`: cookie → `X-Auth-Token` → `?token=` (SSE)
  - Client: `credentials: "include"` everywhere; localStorage kept only for EventSource transitional fallback
  - Files: `server/auth.mjs`, `server/index.mjs`, `src/api/client.ts`, `src/store/slices/authSlice.ts`
  - [ ] Remove localStorage token entirely once SSE no longer needs `?token=`
- [x] **CSRF protection (Origin/Referer)**
  - `checkCsrf(req, res)` for cookie-authenticated mutating methods
  - SameSite=Lax + origin allowlist (host / x-forwarded-*)
  - Auth login/register exempt (no cookie yet / set cookie)
- [ ] **Rate limiting – per-user, not just per-IP**
  - Current: IP-based only – easy to bypass with proxies
  - Add: Redis / in-memory per-user bucket
  - Endpoints: `/api/session/*/message`, `/api/sandbox/apply`, `/api/rebuild`
- [ ] **Self-improve sandbox – further hardening**
  - ✅ Already done: src/** allowlist only, vitest gate, 2× auto-correct
  - TODO:
    - [ ] Block `eval()`, `Function()`, `import()` with dynamic strings – use ESLint `no-eval` in sandbox
    - [ ] Run `npm run build` in sandbox too (not just `tsc -b`) – catch Vite-specific errors
    - [ ] Resource limits: CPU 5s, Memory 512 MB per sandbox run – use `ulimit` / cgroups
    - [ ] npm audit in sandbox – block deploy if new vulnerabilities introduced
- [ ] **Content Security Policy – remove `'unsafe-inline'` for styles**
  - Current: `style-src 'self' 'unsafe-inline'` – needed for React inline styles
  - After Tailwind migration: remove `'unsafe-inline'` where possible; keep only for remaining dynamic widths
  - Verify in `server/middleware.mjs` → `setSecurityHeaders()`
- [ ] **Secrets rotation – URGENT**
  - GitHub PAT and Railway token were shared in plaintext in chat / local files
  - Action: revoke both immediately after development session
  - Store new tokens in: 1Password / Railway Variables / GitHub Secrets only
  - Add `.env` to `.gitignore` – already done? check
  - Add GitHub secret scanning / push protection
- [x] **Dependency scanning (baseline)**
  - Dependabot: `.github/dependabot.yml` – weekly npm + GitHub Actions
  - `npm audit --audit-level=high` in CI
  - [ ] Add Snyk / OSV scanner

---

## ⏳ Planned – Phase 7: Frontend modern features

- [ ] **React Compiler – already installed, verify it works**
  - `babel-plugin-react-compiler` is in `vite.config.ts`, opt-in
  - Check build logs: look for `"React Compiler"` – currently graceful-degrades if not installed locally
  - Once deployed on Railway (Node 22), verify: `grep -r "useMemoCache" dist/`
  - Then remove manual `useMemo`/`useCallback` where compiler handles it
  - Files to clean: `src/store/useStore.ts`, `src/components/ChatView.tsx`, `MessageItem.tsx`
- [ ] **React 19 new APIs**
  - `useOptimistic` – for optimistic message send in Composer
  - `useActionState` / `useFormStatus` – for LoginPage / Settings forms
  - `use()` – for promises in Server Components (N/A – we're SPA)
- [ ] **TanStack Router v1**
  - Current: no router, single-page `App.tsx` with conditional rendering
  - Migrate to: file-based routing
  - Routes: `/`, `/login`, `/chat/:sessionId`, `/settings`
  - Benefits: type-safe navigation, code splitting, search params
  - `npm install @tanstack/react-router`
- [ ] **State management – Zustand 5 is good, add persist**
  - Add: `import { persist, createJSONStorage } from 'zustand/middleware'`
  - Persist: theme, sidebar collapsed state, last model
  - Storage: IndexedDB via `idb-keyval` (not localStorage – avoid quota)
- [ ] **Markdown rendering – upgrade**
  - Current: `react-markdown 10.1 + remark-gfm` + typography plugin
  - Add: `rehype-highlight` / `shiki` for code syntax highlighting
  - Add: `remark-math` + `rehype-katex` for math rendering
- [ ] **Virtualization – already using `@tanstack/react-virtual` 3.14.5 ✓**
  - Verify it works with new ChatView after Tailwind migration
  - Add overscan: 5, smooth scroll
- [ ] **Accessibility**
  - Run axe-core: `npm install -D @axe-core/react`
  - Fix: keyboard navigation in Composer, Sidebar, Settings
  - ARIA labels: all icon buttons
  - Focus trap: Settings Dialog, Permission Dialog
  - Color contrast: verify WCAG AA – primary #7c5cff on #0b0b0f = 5.8:1 ✓
- [ ] **i18n**
  - Add: `react-i18next`
  - Languages: EN (default), RU, NL
  - Extract all hardcoded strings in components

---

## ⏳ Planned – Phase 8: Backend / DevOps

- [ ] **Health checks – OpenCode child monitoring**
  - Current: server starts OpenCode on `:4096`, no restart if it crashes
  - Add: heartbeat every 5s, auto-restart with exponential backoff
  - Add: `/health` already proxies to OpenCode – good
  - Add: readiness probe, liveness probe for Railway
- [ ] **Structured logging**
  - Replace `console.log` with `pino`
  - `npm install pino pino-pretty`
  - JSON logs in production, pretty in dev
  - Log levels: trace/debug/info/warn/error/fatal
  - Correlate: add `x-request-id` header, propagate to OpenCode
- [ ] **Observability – Sentry**
  - `npm install @sentry/node @sentry/react`
  - Frontend: error boundary → Sentry.captureException
  - Backend: uncaughtException / unhandledRejection → Sentry
  - Performance tracing: API calls, rebuild times
  - Free tier is enough for small project
- [ ] **Docker image size**
  - Current: ~800 MB (node:22-slim + full node_modules incl. devDeps)
  - Target: <400 MB
  - Strategy:
    - Multi-stage: build stage with devDeps, runtime stage with prod deps only
    - Self-improve rebuilds → run in ephemeral container with devDeps mounted, not in prod image
    - Use `node:22-alpine` – ~50 MB smaller, test if `opencode-ai` CLI works on musl
  - Measure: `docker images opencode-ui`
- [ ] **Database backups**
  - Current: JSON files in Railway Volume – no backup
  - After SQLite migration (Phase 6):
    - Nightly: `sqlite3 /app/workspace/db.sqlite .dump | gzip > /backups/db-YYYY-MM-DD.sql.gz`
    - Upload to R2 / S3
    - Retention: 7 daily, 4 weekly
  - Until then: git-backup `.users.json`, `.sessions.json` nightly to private repo
- [ ] **CI/CD – promote GitHub Actions to deploy gate**
  - Current: Railway auto-deploys on push to main – no CI gate
  - Change:
    1. GitHub Actions CI runs: test → build → docker build
    2. If CI passes → trigger Railway deploy via webhook / Railway CLI
    3. Railway: disable auto-deploy, use `railway up --service opencode-ui --environment production` from CI
  - Add: preview deployments for PRs – Railway PR environments
- [ ] **Environment / secrets management**
  - Move all secrets to Railway Variables – never in repo
  - Add: `.env.example` with all required vars documented – ✅ already exists
  - Add: `OPENCODE_ADMIN_EMAILS` – already supported in `server/auth.mjs` ✓
  - Add: `SENTRY_DSN`, `NODE_ENV=production`
  - Rotate: GitHub PAT, Railway token – URGENT, see Phase 6

---

## ⏳ Planned – Phase 9: Self-improve AI – next level

- [ ] **Sandbox – Biome + build check**
  - Current: Prettier → tsc → vitest
  - Add: `biome check` (replaces Prettier)
  - Add: `vite build` in sandbox – catch Vite-specific errors before deploy
  - Increase timeout: 30s → 60s (build is heavier)
- [ ] **Test coverage gate in sandbox**
  - Current: vitest must pass (all 96 tests)
  - Add: coverage must not drop – `vitest run --coverage --coverage.thresholds.statements=70`
  - Block deploy if coverage drops >5%
- [ ] **Visual regression in sandbox**
  - After successful build, run Playwright screenshot compare
  - Baseline screenshots in git LFS
  - Block deploy if visual diff > tolerance
  - Library: `@playwright/test` + pixelmatch
- [ ] **AST-modifier – expand operations**
  - Current: `addImport`, `addRoute`
  - Add: `replaceFunction`, `addComponent`, `updateProp`, `wrapWithErrorBoundary`
  - Use case: agent can safely refactor React components without breaking JSX structure
- [ ] **Multi-file refactoring – dependency graph**
  - Current: agent sends `{path, content}[]` – flat list
  - Add: topological sort by import graph – apply files in correct order
  - Detect circular deps, break early
- [ ] **Rollback – instant, no rebuild**
  - Current: `git reset --hard + npm run build` – 30-60s downtime
  - Target: keep last 3 builds in `/app/dist-v1/v2/v3`, switch symlink instantly
  - Rollback time: <100ms
  - Implement: `server/self-improve.mjs` → `rollbackToCommit()` keep old dist folders
- [ ] **A/B testing for UI improvements**
  - Self-improve agent proposes 2 variants → build both → 50/50 traffic split
  - Measure: time-to-first-message, error rate
  - Auto-promote winner after N sessions
  - Overkill for now – backlog

---

## 📊 Metrics – track progress

| Metric | Before (2026-07-10 08:00) | After 2b finish | Target |
|---|---|---|---|
| React | 19.1 | **19.2.x** | 19.x latest |
| Vite | 7.0.0 | 7.x | 7.x |
| Tailwind | none | **4.x** | 4.x |
| Node | 22 | 22 | 22 LTS |
| npm audit vulns | 0 | **0** | 0 |
| Test count | 96 | **106** | >120 |
| Test coverage | ? | ? | >70% |
| Legacy `styles.css` | 56 KB / 2300 LOC | **deleted** | deleted |
| Bundle CSS | dual stack | Tailwind only | <25 KB gzip |
| Dependencies (prod) | 115 | ~shadcn/radix set | <100 |
| `http-proxy` CVE risk | YES | **NO** | NO |
| Sandbox RCE risk | HIGH | **MEDIUM** (src/** only) | LOW |
| Auth storage | JSON files | JSON files | SQLite |
| Session tokens | localStorage | **HttpOnly cookie (+ header fallback)** | cookie only |

| CSP `unsafe-inline` (style) | YES | reduced | NO |
| PWA | NO | **YES** (manifest + workbox) | YES + icons |
| React Compiler | NO | **YES** (opt-in) | YES, fully enabled |
| CI | NO | **YES** (GitHub Actions) | YES + deploy gate |
| E2E tests | NO | NO | Playwright |
| Linter | Prettier | **Biome 2.5** | Biome |
| Typography plugin | NO | **YES** | YES |
| Syntax highlighting | NO | NO | shiki |

---

## 🚀 Quick start for contributors / AI agent

1. **Read this plan first** – understand what's done / what's next
2. **Self-improve mode**: only edit files in `src/**` via `/api/sandbox/apply`
   - Sandbox runs: Prettier → `tsc -b` → `vitest run`
   - Blocked paths: `package.json`, `server/**`, config files – see `server/sandbox.mjs`
3. **After successful sandbox deploy**: call `POST /api/rebuild` to rebuild Vite bundle
4. **Run tests locally**: `npm run test:all` – must stay at 96+ passing
5. **Check types**: `npx tsc -b`
6. **Lint**: `npm run lint` (Biome)
7. **Before committing**: update this `MIGRATION_PLAN.md` – check off completed items, update metrics table
8. **Commit message format**: `feat(ui): ...`, `fix: ...`, `chore: ...`, `security: ...`, `ui: ...`
9. **Push to main** → Railway auto-deploys → verify at `https://opencode-ui-production.up.railway.app`
10. **Check Railway logs**: via GraphQL API, deployment ID in CI output

**Critical files – DO NOT edit via self-improve sandbox (blocked anyway):**
- `package.json` / `package-lock.json` – dependency changes must be human-reviewed (RCE risk)
- `server/**` – backend, auth, proxy – security critical
- `vite.config.ts`, `tsconfig.json` – build config
- `Dockerfile`, `railway.json` – deploy config
- `.github/workflows/**` – CI config

**Safe to edit via sandbox:**
- `src/components/**`
- `src/store/**`
- `src/api/**`
- `src/config/**`
- ~~`src/styles.css`~~ – **deleted in Phase 2b.8**; use Tailwind utilities + `src/index.css` tokens

---

## 📝 Changelog

- **2026-07-10 11:10 UTC** – Initial audit, cloned repo, checked Railway deploy – SUCCESS
- **2026-07-10 11:27 UTC** – `chore: drop http-proxy, upgrade to React 19.2 / react-markdown 10` – commit `efeee22` – deploy SUCCESS
- **2026-07-10 11:38 UTC** – `security: harden self-improve sandbox + CI` – commit `e5fc3bd` – deploy SUCCESS
  - sandbox src/** allowlist, vitest gate, 2× auto-correct
  - GitHub Actions CI, Dockerfile npm ci
- **2026-07-10 11:49 UTC** – `feat(ui): Tailwind CSS 4 + shadcn/ui foundation` – commit `0fdf46d` – deploy SUCCESS
  - Tailwind 4.1, shadcn Button/Input/Card, @/* alias
  - styles.css kept for gradual migration
- **2026-07-10 12:00 UTC** – `chore: Biome + React Compiler + PWA` – commit `89b120a` – deploy FAILED (package-lock out of sync)
- **2026-07-10 12:04 UTC** – `chore: update package-lock` – commit `de7328c` – deploy SUCCESS
- **2026-07-10 12:14 UTC** – `ui: migrate Composer to Tailwind + shadcn` – commit `69e4148` – deploy SUCCESS
- **2026-07-10 12:xx UTC** – `docs: add full modernization plan MIGRATION_PLAN.md` – commit `f28301f`
- **2026-07-10** – `ui: migrate Sidebar to Tailwind + shadcn` – commit `1b8523d`
- **2026-07-10** – `ui: migrate ChatView + MessageItem to Tailwind` – commit `256d114`
- **2026-07-10** – `ui: migrate TopBar + ModelSelector to Tailwind` – commit `d61497c`
- **2026-07-10 13:00 UTC** – `ui: migrate SettingsPanel to Tailwind + shadcn` – commit `4d5c960` – deploy SUCCESS
- **2026-07-10 14:xx UTC** – Plan sync + finish Phase 2b
  - Update plan to match git reality (Sidebar/Chat/TopBar/Settings done)
  - Migrate: CopyButton, Skeleton, PartView, ToolCard, ToolGroup, LoginPage, PermissionDialog, ErrorBoundary, Workspace, App shell
  - Add `@tailwindcss/typography`
  - Delete `src/styles.css`, base layout in `src/index.css`
  - Tests + build gate – commit `ea7cb24`
- **2026-07-10 14:20 UTC** – Phase 6 security baseline + CI quality
  - HttpOnly `opencode_session` cookie + CSRF Origin check
  - Client `credentials: "include"`; transitional localStorage for SSE
  - Dependabot, npm audit CI, Biome soft gate
  - Dockerfile copies full `server/` (sandbox/ast modules)
  - Auth tests expanded → **106 tests**
  - Docs: SELF_IMPROVE.md, .env.example

**Next up:** verify Railway SUCCESS for cookie deploy; rotate secrets; hard Biome gate / Playwright / SQLite auth.

---

*This file is living documentation – update it on every significant change. It's also read by the self-improvement agent at startup (`SELF_IMPROVE_GUIDE.md` references it).*
