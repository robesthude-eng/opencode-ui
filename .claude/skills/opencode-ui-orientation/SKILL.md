---
name: opencode-ui-orientation
description: "Use when starting work on the opencode-ui repository (a React web UI plus a Node/Express-style proxy server that wraps an OpenCode instance, deployed to a Timeweb VDS). Provides the architecture overview, file map, session-isolation model, credential-handling rules, and deploy conventions so you can navigate and edit the project correctly without breaking isolation or the deploy pipeline."
---

# opencode-ui — Project Orientation

> **OFFLINE NOTE:** This project is typically edited inside an assistant environment with **no internet access**. Rely on your built-in knowledge of the codebase and current best practices; do NOT fetch external docs, npm registry, or run `npm install`. The final deliverable is a ZIP of the corrected code (see `opencode-ui-modernize`).

## What this project is
`opencode-ui` is a custom web chat UI for OpenCode (sst/opencode). It serves a *built* React frontend and proxies `/api/*` to a single OpenCode "system" instance on the loopback (`127.0.0.1:4096`). Each chat gets an **isolated workspace** so conversations do not share files or memory — like Claude.ai.

## Runtime model (Timeweb VDS)
- Docker multi-stage build: build React via `npm run build` (tsc + vite) → `dist/`.
- Runtime image installs the `opencode-ai` CLI and copies the server modules + built frontend.
- `start.sh` (sh) starts `node server.mjs` (UI/proxy) and `opencode serve` (system instance) on a persistent Docker volume mounted at `/app/workspace`.
- GitHub Actions deploys successful `main` builds to the Timeweb VDS. Healthcheck: `/health`.

## Key files
| Path | Role |
|---|---|
| `server.cjs` | Entrypoint; requires `server/index.cjs`. |
| `server/index.cjs` | HTTP server: static serving, proxy, auth, session lifecycle, self-improve routes. |
| `server/auth.cjs` | Password hashing/verify, `checkAuth`, `isAdmin` (first registered user = admin, or `OPENCODE_ADMIN_EMAILS`). |
| `server/db.cjs` | JSON load/save helpers for `.users.json`, `.sessions.json`. |
| `server/middleware.cjs` | Security headers, body size limits, rate limits. |
| `server/upload.cjs` | Multipart parser for file uploads. |
| `server/self-improve.cjs` | Admin-only rebuild/reset/git checkpoint+rollback of the UI source. |
| `src/api/client.ts` | Frontend API client (chat, files, git). `listDir/readFile/gitStatus` accept `sessionId`. |
| `src/api/events.ts` | SSE event-bus client. |
| `src/components/Workspace.tsx` | Side file browser; reads `currentID`, bails when no chat selected. |
| `src/store/slices/*` | Zustand store slices (auth, messages, sessions, models, ui). |
| `src/components/ChatView.tsx` | Main chat view (welcome screen, composer). |
| `Dockerfile` | Multi-stage build + runtime (node:20-slim, opencode-ai@1.17.13). |
| `start.sh` | Boot orchestration + workspace cleanup + OpenCode config. |

## Session-isolation model (critical)
- New chat → `POST /api/session` creates a clean `sessions/{id}/workspace` (+ `uploads/`).
- Every per-session proxied request appends `?directory=/app/workspace/sessions/{id}/workspace` so OpenCode operates only inside that chat's folder.
- `extractSessionId(req)` reads from path, `?sessionId=`, or header `x-session-id`; temp `tmp_*` IDs are rejected.
- Global routes (`/api/config/providers`, `/api/provider`, `/api/auth/`, `/api/global/`) never get `directory=`.
- Delete chat → `DELETE /api/session/:id` removes the folder AND proxies the delete to OpenCode **with** `directory=` so OpenCode memory is cleared.
- No per-session OpenCode process pool (it broke SSE); one system instance + global event bus + 500ms polling fallback.

## Credential & token rules (HARD)
- NEVER store GitHub/Timeweb tokens in `.git/config`, `.env`, or any committed file.
- At runtime read them from `uploads/Github.txt` into shell variables; strip the token from the git remote URL after cloning.
- - `OPENCODE_ZEN_API_KEY` and `OPENCODE_MODEL` are Timeweb environment variables, NOT in the repo.
- `OPENCODE_SERVER_PASSWORD` may be unset → app falls back to a random `.admin_password` on the volume, or to multi-user registration.

## Conventions when editing
- Frontend is TypeScript + React 18 (per package.json). Keep `tsc -b` passing.
- Server is CommonJS (`.cjs`) even though `package.json` is `"type": "module"` — keep that split unless deliberately converting (see `opencode-ui-modernize`).
- After any code change: commit, push to `main`, wait for GitHub Actions deploy and verify `/health` on Timeweb, then confirm behavior.
