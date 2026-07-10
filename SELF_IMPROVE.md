# Self-Improvement Guide

This folder contains the source code of YOUR web interface — the OpenCode UI
that you (the AI agent) are running through right now.

## You CAN improve this UI

1. **Read** the source files in `src/` to understand the structure
2. **Edit** any `.tsx` / `.ts` file under `src/` (prefer sandbox — see `SELF_IMPROVE_GUIDE.md`)
3. **Rebuild** via `POST /api/rebuild` (admin) or:
   ```bash
   cd /app/workspace/opencode-ui && npm install && npx vite build --outDir /app/dist
   ```
4. The changes will appear immediately in the browser after reload

## Architecture

- `src/components/` — React components (Sidebar, ChatView, Composer, etc.)
- `src/components/ui/` — shadcn/Radix primitives (Button, Dialog, …)
- `src/store/useStore.ts` — state management (Zustand)
- `src/api/client.ts` — OpenCode API client (cookie + transitional header auth)
- `src/index.css` — Tailwind 4 entry + design tokens (legacy `styles.css` removed)
- `src/components/icons.tsx` — SVG icons
- `server/` — production server (auth, proxy, sandbox, static)

## Styling

Use **Tailwind utility classes** and shadcn primitives. Do not reintroduce a large
global CSS file. Tokens live in `src/index.css` (`@theme`).

## Rebuild command

```bash
cd /app/workspace/opencode-ui
npm install --silent
npx vite build --outDir /app/dist
```

After rebuilding, the UI updates on next page load.
