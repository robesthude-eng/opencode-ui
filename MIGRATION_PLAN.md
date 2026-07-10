# OpenCode UI – Full Modernization Plan
_Last updated: 2026-07-10 – commit 69e4148_

This document tracks the ongoing migration to latest technologies. Use it as a checklist for the self-improvement agent and human contributors.

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
- [x] Railway deployment: 5 successful deploys in a row
  - Latest: `f389fc2c` – SUCCESS – `opencode-ui-production.up.railway.app`

### Tests
- [x] 96 tests passing (Vitest 4.1.10)
  - src/__tests__: 11 + 8 + 8 + 15 = 42
  - server/__tests__: 10 + 5 + 9 + 5 + 1 + 1 = 31
  - + helpers, etc. = 96 total

---

## ✅ Completed – Phase 2a: Tailwind / shadcn foundation (2026-07-10)

- [x] Tailwind CSS **4.1.14** + `@tailwindcss/vite`
- [x] shadcn/ui deps:
  - `tailwind-merge 3.6.0`, `clsx 2.1.1`, `class-variance-authority 0.7.1`
  - `lucide-react 1.24.0`, `tw-animate-css 1.4.0`
  - `@radix-ui/react-slot 1.3.0`
- [x] Path alias `@/*` → `./src/*` (tsconfig + vite + vitest)
- [x] `src/index.css` – Tailwind entry + design tokens matching existing dark UI
  - colors: background #0b0b0f, card #14141c, primary #7c5cff, etc.
  - radius: 0.75rem
- [x] UI primitives in `src/components/ui/`:
  - `button.tsx` – variants: default / destructive / outline / secondary / ghost / link
  - `input.tsx`
  - `textarea.tsx`
  - `card.tsx` – Card / CardHeader / CardTitle / CardContent
- [x] `src/main.tsx` imports `./index.css` before `./styles.css` – **safe gradual migration, no visual break**
- [x] Build: CSS 44.7 → 59.2 KB / gzip 8.5 → 11.6 KB, JS 438 KB unchanged
- [x] Tests: 96 passed

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

Goal: migrate all `src/components/*.tsx` from legacy `styles.css` to Tailwind + shadcn, then delete `src/styles.css` (~56 KB).

Migration order – dependencies first, low risk → high risk:

### 2b.1 – Composer ✅ DONE – commit 69e4148
- [x] `src/components/Composer.tsx`
  - shadcn `Button`, custom `<textarea>` with Tailwind
  - Attachments: pill chips, emerald check badge
  - Upload progress: SVG circular
  - Input: `rounded-2xl border bg-card shadow-sm focus-within:ring-2`
  - Hint: "Shift+Enter for new line • Drag & drop"
  - Build: JS 438 → 471 KB, CSS 59.2 → 65.0 KB
  - Tests: 96 passed, deploy SUCCESS

### 2b.2 – Primitives – TODO
- [ ] `src/components/CopyButton.tsx` → shadcn Button ghost/sm
- [ ] `src/components/Skeleton.tsx` → Tailwind animate-pulse
- [ ] `src/components/icons.tsx` → migrate to `lucide-react` where possible, keep custom OpenCode icons

### 2b.3 – Sidebar – TODO
- [ ] `src/components/Sidebar.tsx`
  - Chat list, new chat button, search
  - Use shadcn: Button, ScrollArea, Input
  - Mobile: Sheet / Drawer (add `@radix-ui/react-dialog`)
  - Estimated: ~200 LOC

### 2b.4 – Chat view – TODO
- [ ] `src/components/ChatView.tsx`
- [ ] `src/components/MessageItem.tsx`
- [ ] `src/components/PartView.tsx`
- [ ] `src/components/ToolCard.tsx`
- [ ] `src/components/ToolGroup.tsx`
  - Markdown rendering: keep `react-markdown`, style with Tailwind Typography (`@tailwindcss/typography`)
  - Code blocks: syntax highlight – add `rehype-highlight` or `shiki`
  - Streaming cursor, tool calls – preserve UX
  - Estimated: ~600 LOC

### 2b.5 – Top bar – TODO
- [ ] `src/components/TopBar.tsx`
- [ ] `src/components/ModelSelector.tsx`
  - shadcn: Select / DropdownMenu (`@radix-ui/react-select`)
  - Estimated: ~150 LOC

### 2b.6 – Settings / Auth – TODO
- [ ] `src/components/SettingsPanel.tsx` – **has tests!** update snapshots after migration
  - shadcn: Dialog, Tabs, Switch, Label, Input
  - Add `@radix-ui/react-dialog`, `@radix-ui/react-tabs`, `@radix-ui/react-switch`, `@radix-ui/react-label`
- [ ] `src/components/LoginPage.tsx`
  - shadcn: Card, Input, Button, Label
  - Add form validation: `react-hook-form` + `zod`
- [ ] `src/components/PermissionDialog.tsx`

### 2b.7 – Workspace – TODO
- [ ] `src/components/Workspace.tsx`
  - File tree, editor – keep sql.js integration

### 2b.8 – Cleanup
- [ ] Delete `src/styles.css` (56 KB, ~1800 LOC)
- [ ] Remove legacy CSS classes from all components
- [ ] Verify bundle size drops: expect JS ~440 KB, CSS ~25 KB (vs current 471 / 65 KB with both stacks)
- [ ] Visual regression test – run Playwright (see Phase 5)
- [ ] Update `SELF_IMPROVE.md` – remove old CSS references

**UI component checklist to install:**
```
npm install @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-select @radix-ui/react-tabs @radix-ui/react-switch @radix-ui/react-label @radix-ui/react-scroll-area @radix-ui/react-tooltip
npm install react-hook-form zod @hookform/resolvers
npm install -D @tailwindcss/typography
```

**shadcn components to generate:**
- dialog, dropdown-menu, select, tabs, switch, label, scroll-area, tooltip, badge, separator, sheet, skeleton, alert

---

## ⏳ Planned – Phase 4: Package manager & build

- [ ] **pnpm migration**
  - `npm install -g pnpm`, `pnpm import` (converts package-lock.json)
  - Update `package.json`: `"packageManager": "pnpm@10.0.0"`
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
  - Current: 96 tests, no coverage threshold
  - Add: `"test:coverage": "vitest run --coverage"`
  - Target: >70% statements for `src/api/`, `src/store/`
  - Add: `npm install -D @vitest/coverage-v8`
- [ ] **Biome CI gate**
  - Add to `.github/workflows/ci.yml`: `npm run lint`
  - Fail PR if biome check fails
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
- [ ] **Session tokens – localStorage → HttpOnly cookie**
  - Current: `X-Auth-Token` header, token stored in localStorage → XSS = account takeover
  - Change to: `Set-Cookie: session=...; HttpOnly; Secure; SameSite=Lax`
  - CSRF protection: Double-submit token OR SameSite strict + Origin check
  - Update: `server/auth.mjs`, `src/api/client.ts`, `src/store/useStore.ts`
- [ ] **CSRF protection**
  - Add CSRF token to all POST/PUT/DELETE
  - Middleware: `checkCsrf(req)` in `server/middleware.mjs`
  - Exempt: `/api/auth/login`, `/api/auth/register` (they set the cookie)
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
  - After Tailwind migration: remove `'unsafe-inline'`, use only utility classes
  - Verify in `server/middleware.mjs` → `setSecurityHeaders()`
- [ ] **Secrets rotation – URGENT**
  - GitHub PAT `ghp_wYnnO…` and Railway token `64b956ff-…` were shared in plaintext in chat / repo history
  - Action: revoke both immediately after development session
  - Store new tokens in: 1Password / Railway Variables / GitHub Secrets only
  - Add `.env` to `.gitignore` – already done? check
  - Add GitHub secret scanning / push protection
- [ ] **Dependency scanning**
  - Enable Dependabot: `.github/dependabot.yml` – weekly npm updates
  - Add `npm audit` to CI – fail on high/critical
  - Add Snyk / OSV scanner

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
  - Current: `react-markdown 10.1 + remark-gfm`
  - Add: `rehype-highlight` / `shiki` for code syntax highlighting
  - Add: `remark-math` + `rehype-katex` for math rendering
  - Add: Tailwind Typography `prose prose-invert` for beautiful defaults
  - `npm install @tailwindcss/typography rehype-highlight rehype-katex remark-math`
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

- [ ] **Sandbox – ESLint + build check**
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

| Metric | Before (2026-07-10 08:00) | Now (2026-07-10 12:15) | Target |
|---|---|---|---|
| React | 19.1 | **19.2.7** | 19.x latest |
| Vite | 7.0.0 | 7.0.0 | 7.x |
| Node | 22 | 22 | 22 LTS |
| npm audit vulns | 0 | **0** | 0 |
| Test count | 96 | **96** | >120 |
| Test coverage | ? | ? | >70% |
| Bundle JS (gzip) | 135.5 KB | **146.9 KB** | <130 KB (after styles.css removal) |
| Bundle CSS (gzip) | 8.5 KB | **12.5 KB** | <10 KB |
| Dependencies (prod) | 115 | ~125 | <100 |
| `http-proxy` CVE risk | YES | **NO** | NO |
| Sandbox RCE risk | HIGH | **MEDIUM** (src/** only) | LOW |
| Auth storage | JSON files | JSON files | SQLite |
| Session tokens | localStorage | localStorage | HttpOnly cookie |
| CSP `unsafe-inline` (style) | YES | YES | NO (after Tailwind full migration) |
| PWA | NO | **YES** (manifest + workbox) | YES + icons |
| React Compiler | NO | **YES** (opt-in) | YES, fully enabled |
| CI | NO | **YES** (GitHub Actions) | YES + deploy gate |
| E2E tests | NO | NO | Playwright |
| Linter | Prettier | **Biome 2.5** | Biome |

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
8. **Commit message format**: `feat(ui): ...`, `fix: ...`, `chore: ...`, `security: ...`
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
- `src/styles.css` – until it's deleted in Phase 2b.8

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
- **2026-07-10 12:00 UTC** – `chore: Biome + React Compiler + PWA` – commit `89b120a` – deploy **FAILED** (package-lock out of sync)
- **2026-07-10 12:04 UTC** – `chore: update package-lock` – commit `de7328c` – deploy SUCCESS
- **2026-07-10 12:14 UTC** – `ui: migrate Composer to Tailwind + shadcn` – commit `69e4148` – deploy SUCCESS
  - Composer rewritten with Tailwind utilities, shadcn Button
  - Tests: 96 passed

**Next up:** `Sidebar` → `ChatView` → `MessageItem` → … → delete `styles.css`

---

*This file is living documentation – update it on every significant change. It's also read by the self-improvement agent at startup (`SELF_IMPROVE_GUIDE.md` references it).*
