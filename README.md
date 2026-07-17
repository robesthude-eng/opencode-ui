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

## Production model

The current production path is:

```text
GitHub main → GitHub Actions CI → SSH deploy → Timeweb VDS → Docker Compose
```

The deploy workflow pins the VDS SSH host key, runs only after CI succeeds, and checks the running service through the deploy script. The app is currently exposed on port 3000. HTTPS and `Secure` cookies should be enabled only after a public domain is connected to the VDS.

## Authentication and authorization

### Password mode

If `OPENCODE_SERVER_PASSWORD` or `OPENCODE_UI_PASSWORD` is configured and no database users exist, the app uses single-operator HTTP Basic Auth. The Basic Auth user defaults to `opencode` and can be changed with `OPENCODE_SERVER_USER`.

- Every non-health UI, API and WebSocket route requires Basic Auth.
- Email/password login and registration are disabled in password mode.
- `/auth/me` exposes a synthetic admin identity to the UI after Basic Auth succeeds.

If no password is configured, the server generates one on first start and writes it to the protected persistent workspace file `/app/workspace/.admin_password`.

### Multi-user mode

When database users exist, the app uses email/password accounts and HttpOnly session cookies. The first registered account becomes an admin. Additional admins can be granted with:

```text
OPENCODE_ADMIN_EMAILS=alice@example.com,bob@example.com
```

Session cookies are `HttpOnly` and `SameSite=Lax`. Do not enable `Secure` until the service is served over HTTPS.

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
npm run test:e2e   # Playwright against PLAYWRIGHT_BASE_URL or local preview
```

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
