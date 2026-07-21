---
name: opencode-ui-orientation
description: "Use when editing opencode-ui. Describes the current React/Node.js ESM architecture, Timeweb VDS deployment, session isolation and self-improve safety invariants."
---

# OpenCode UI — current project orientation

## Runtime

- React 19 + Vite 7 frontend, TypeScript and Zustand.
- Node.js 22 ESM proxy: `server.mjs` → `server/index.mjs`.
- OpenCode runs once on `127.0.0.1:4096`; the UI/proxy listens on port 3000.
- Docker Compose runs on a Timeweb VDS with persistent data in `/app/workspace`.
- GitHub Actions deploys successful `main` builds through a pinned SSH host key. Verify `/health` after deploy.

## Important paths

| Path | Purpose |
|---|---|
| `server.mjs` | ESM entrypoint |
| `server/index.mjs` | HTTP proxy, auth, sessions and admin routes |
| `server/auth.mjs` | Password hashing, sessions, CSRF and auth helpers |
| `server/db.mjs` | SQLite-backed compatibility persistence layer |
| `server/sandbox.mjs` | Validated self-improve source changes |
| `server/self-improve.mjs` | Rebuild, snapshots, checkpoints and rollback |
| `src/store/` | Zustand state slices |
| `src/api/` | OpenCode REST/SSE client |
| `src/components/` | React UI |
| `.github/workflows/` | CI and Timeweb deployment |

## Session isolation — do not weaken

- Every chat uses `sessions/<id>/workspace`.
- Per-session proxy requests must preserve `?directory=` pointing at that workspace.
- Global routes never receive `directory=`.
- Deleting a session removes its local files and proxies deletion with the same `directory=`.
- Keep one OpenCode system instance; the previous per-session pool broke SSE.

## Agent On-Demand Capabilities & Sudo

Every isolated chat session (`opencode-runner`) and the main self-improve sandbox runs as user `node` (`HOME=/session/.home`) with **passwordless sudo privileges** (`sudo apt-get update && sudo apt-get install -y ...`). Agents have 5 on-demand superpowers to install and invoke whenever tasks require them:
1. **Dev Tools:** Install `sudo apt-get install -y ripgrep jq sqlite3 gh` when searching large codebases, inspecting databases, or managing GitHub PRs.
2. **Visual UI QA & Screenshots:** Chromium is pre-installed at `/ms-playwright` (`PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`). Run `npx playwright test` or standalone scripts to capture UI screenshots and inspect them via vision models.
3. **MCP Protocol Servers:** Launch `@modelcontextprotocol/server-*` via `npx -y` to connect directly to databases, GitHub, or headless browsers.
4. **Virtual Graphical Screen (Xvfb/noVNC):** Install `sudo apt-get install -y xvfb x11vnc fluxbox` when GUI apps or live browser previews are required.
5. **AST & LSP Language Servers:** Install `npm i -g typescript-language-server pyright` for AST traversal, semantic symbol lookups, and strict type validation across large repositories.

## Security invariants

- Never commit credentials, tokens or provider keys.
- Password mode is single-operator Basic Auth; registration/login are disabled while it is active.
- Multi-user mode uses HttpOnly cookies and admin-only self-improve routes.
- Self-improve may modify only validated `src/**` paths.
- The sandbox enforces path boundaries, a file/size limit, mandatory tests, serialized runs and rollback when the Git checkpoint fails.
- A source checkpoint is not a release. `/api/rebuild` must publish a new UI build.

## Before submitting a change

```bash
npm run ci
```

Then commit, push, wait for GitHub Actions CI and Timeweb deploy, and verify `/health`.
