# OpenCode UI

A web interface for [OpenCode](https://github.com/sst/opencode), a headless AI coding agent. The browser talks to a Node.js proxy, which serves the React UI and forwards OpenCode API and event traffic to a local OpenCode system instance.

```text
Browser (React) ── HTTPS/HTTP + SSE ──> Node.js UI/proxy (:3000)
                                          └──> OpenCode (:4096, loopback only)
```

## Features

- Streaming chat with SSE and a resilient polling fallback.
- Per-session isolated workspaces: `sessions/<session-id>/workspace`.
- Session deletion removes the associated workspace and ownership metadata.
- Markdown, code highlighting, reasoning, tool cards and permission prompts.
- Provider-key management for supported OpenCode providers.
- Light/dark theme, responsive layout and workspace browser.
- Admin-only self-improvement workflow with validation, checkpoints and rollback tools.
- SQLite-backed users, sessions and ownership records; scheduled/manual backups.
- Redis-backed shared rate limits when `RATE_LIMIT_REDIS_URL` is configured (with a local-development fallback).

## Production model

The current production path is:

```text
GitHub main → GitHub Actions CI → SSH deploy → Timeweb VDS → Docker Compose
```

The deploy workflow pins the VDS SSH host key, runs only after CI succeeds, and checks the running service through the deploy script. The app is currently exposed on port 3000. HTTPS and `Secure` cookies should be enabled only after a public domain is connected to the VDS.

## Authentication and authorization

The app uses email/password accounts and HttpOnly session cookies. The first registered account becomes an admin. On a fresh deployment, register the admin account immediately after the first start; registration can be restricted with an invite code (`OPENCODE_INVITE_CODE`) or an email allowlist. Additional admins can be granted with:

```text
OPENCODE_ADMIN_EMAILS=alice@example.com,bob@example.com
```

Session cookies are `HttpOnly` and `SameSite=Lax`. Do not enable `Secure` until the service is served over HTTPS.


### Reverse-proxy forwarding headers

Forwarding headers are ignored by default. If the UI is behind a reverse proxy, configure the socket address of that proxy explicitly — never a broad public/client range:

```bash
TRUSTED_PROXY_IPS=127.0.0.1,::1
```

Only a peer on this allowlist may provide `X-Forwarded-For`, `X-Forwarded-Host`, or `X-Forwarded-Proto`. This prevents clients connecting directly to port 3000 from spoofing their IP address, origin host, or HTTPS status.


The HTTP API, OpenCode WebSocket upgrade path, and Socket.IO terminal handshake all enforce the same session TTL. An expired token is rejected during the upgrade and removed from persistent session storage immediately.


## Multi-instance rate limiting

A single instance uses an in-memory rate-limit fallback for frictionless local development. For any horizontally scaled deployment, configure the **same** Redis endpoint on every UI instance:

```bash
RATE_LIMIT_REDIS_URL=rediss://:password@redis.example.com:6380/0
```

The Compose stack starts a private Redis service automatically and defaults to `redis://redis:6379`. Limits are evaluated through one atomic Redis Lua operation; login/registration attempts, user/IP heavy requests, uploads, and the self-improvement rebuild cooldown are therefore enforced across instances. A successful login or registration clears its shared authentication-attempt bucket. If a configured Redis store is unavailable, the app returns `503` rather than silently reverting to per-instance limits.

## Self-improvement safety model

Self-improvement is admin-only and disabled by default.

- The only supported mutation endpoint is `/api/sandbox/apply`.
- Only validated `src/**` paths may be changed; absolute paths, traversal, duplicate paths and oversized batches are rejected.
- At most 20 files and 200 KB of source content are accepted per request.
- Sandbox runs are serialized to avoid concurrent changes to the temporary build workspace.
- Every change runs Biome, TypeScript, Vitest and Vite before source is applied. Tests cannot be skipped.
- Applied source changes are checkpointed in the local Git repository. If checkpointing fails, the changed and newly created files are rolled back.
- A successful source checkpoint is **not** a published UI release: the admin must run `/api/rebuild` to publish a new `dist` build.
- The old AST-modifier endpoint was removed; it bypassed the standard validation pipeline.

## Persistent data and backups

OpenCode data, provider credentials and the application database are stored on the persistent VDS volume below `/app/workspace`.

- SQLite database: `/app/workspace/opencode.db`
- OpenCode provider credentials: `/app/workspace/.opencode_data/auth.json`
- Backups: `/app/workspace/backups/`

The volume contains sensitive data. Restrict VDS access, keep backup copies off the server, and rotate any token that was ever pasted into chat, logs or files.

## Local development

Requirements:

1. Node.js **22 or newer**
2. npm 10+
3. OpenCode installed and configured with a provider

Install dependencies:

```bash
npm ci --include=dev
```

Start OpenCode in one terminal:

```bash
opencode serve --port 4096 --hostname 127.0.0.1
```

Start the frontend development server in another terminal:

```bash
npm run dev
```

The Vite server listens on its printed URL, usually `http://localhost:5173`, and proxies `/api` to `http://localhost:4096` by default. Override the target when needed:

```bash
OPENCODE_TARGET=http://host:4096 npm run dev
```

For local Basic Auth development, serve the UI and proxy from the same origin and use the browser's native Basic Auth prompt. Do not place production passwords in frontend source code.

## Quality commands

```bash
npm run lint       # Biome check
npm run typecheck  # TypeScript project check
npm run test:all   # Vitest suite
npm run build      # TypeScript + Vite production build
npm run ci         # lint + tests + build
npm run test:e2e      # Playwright against PLAYWRIGHT_BASE_URL or local preview
npm run test:e2e:ci  # Chromium critical UI suite; requires the included mock backend
```

## CI E2E environment

CI starts `e2e/mock-opencode.mjs`, a deterministic local OpenCode HTTP/SSE substitute, then boots the production Node proxy with an isolated temporary workspace. It registers `admin@local.test` only inside that disposable environment and runs the Chromium full-UI suite. The mock covers health, sessions, messages, event streaming, provider discovery and workspace reads; no model provider, external OpenCode installation, or production credential is needed.

## API overview

The frontend uses the proxy prefix `/api`:

| Action | Endpoint |
| --- | --- |
| List/create sessions | `GET/POST /session` |
| Read/delete session | `GET/DELETE /session/{id}` |
| Load messages | `GET /session/{id}/message` |
| Send a message | `POST /session/{id}/message` |
| Abort a run | `POST /session/{id}/abort` |
| Reply to a permission | `POST /session/{id}/permissions/{permissionId}` |
| Stream events | `GET /event` |
| Health | `GET /global/health` or `GET /health` |

Exact OpenCode payload shapes can vary by OpenCode version. Check the local OpenCode API documentation at `http://localhost:4096/doc` before implementing a new integration.

## Repository layout

```text
src/       React UI, API client, Zustand store and UI components
server/    Node.js proxy, authentication, persistence, sandbox and backups
e2e/       Playwright end-to-end tests
.github/   CI and Timeweb VDS deployment workflow
scripts/   Deployment and developer helper scripts
docs/      Operational documentation
```

## License

MIT — this is an independent community UI. OpenCode is owned by its respective authors.
