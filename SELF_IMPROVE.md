# Self-Improvement Guide

This folder contains the source code of YOUR web interface — the OpenCode UI
that you (the AI agent) are running through right now.

## You CAN improve this UI

1. **Read** the source files in `src/` to understand the structure
2. **Edit** any `.tsx`, `.ts`, or `.css` file
3. **Rebuild** by running: `cd /app/workspace/opencode-ui && npm install && npx vite build --outDir /app/dist`
4. The changes will appear immediately in the browser after reload

## Architecture

- `src/components/` — React components (Sidebar, ChatView, Composer, etc.)
- `src/store/useStore.ts` — state management (Zustand)
- `src/api/client.ts` — OpenCode API client
- `src/styles.css` — all styling
- `src/components/icons.tsx` — SVG icons
- `server.cjs` — production server (proxy + static files)

## Rebuild command

```bash
cd /app/workspace/opencode-ui
npm install --silent
npx vite build --outDir /app/dist
```

After rebuilding, the UI updates on next page load.
