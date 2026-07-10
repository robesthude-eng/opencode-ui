# Self-Improvement Guide

This folder is the source of YOUR web UI — OpenCode UI.

## You CAN improve this UI

1. **Read** `src/`
2. **Edit** only via sandbox: `POST /api/sandbox/apply` (admin + self-improve on)
3. **Rebuild**: `POST /api/rebuild` after successful deploy from sandbox

## Architecture

- `src/components/` — React UI (Sidebar, ChatView, Composer, Settings, …)
- `src/components/ui/` — shadcn/Radix primitives
- `src/store/useStore.ts` — Zustand (+ persist for prefs)
- `src/api/client.ts` — API client (**HttpOnly cookie** auth, `credentials: "include"`)
- `src/index.css` — Tailwind 4 tokens (legacy `styles.css` removed)
- `src/router.tsx` — TanStack Router
- `server/` — auth, proxy, sandbox, backups (not sandbox-editable)

## Sandbox pipeline

**Biome → tsc -b → vitest → vite build**

## Styling

Use Tailwind utilities + shadcn components. Do not reintroduce a large global CSS file.
