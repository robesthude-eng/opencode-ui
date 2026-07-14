# OpenCode UI

A custom **web UI for [OpenCode](https://github.com/sst/opencode)** (the terminal AI coding agent by `sst`).

OpenCode is designed so its engine can run headlessly as an HTTP/SSE server, and any
client (the built-in TUI, `opencode web`, a VS Code extension — or **this app**) can
drive it. This project is a React frontend that talks to that server.

```
 Browser (React app)  ──HTTP + SSE──►  OpenCode headless server (opencode serve, :4096)
```

## Features

- 🗂️ **Minimal sidebar** — "New chat" button + chat list, settings at the bottom
- 💬 **Streaming chat** — assistant tokens and message parts stream in real time
- 🛠️ **Tool rendering** — tool calls shown as cards with state, input and output
- 🧠 **Reasoning** — assistant reasoning is collapsible
- 📝 **Markdown + code** — assistant text rendered with GFM markdown and code blocks
- 🔐 **Permission prompts** — approve/deny tool execution in a dialog
- 🔑 **API key management** — Settings panel to connect your own keys for popular
  AI providers (Anthropic, OpenAI, Google, xAI, DeepSeek, Groq, Mistral, OpenRouter, …)
- 🌗 **Light / dark theme** — toggle in the sidebar, respects OS preference, persisted
- ⏹️ **Stop** — abort a running session
- 🔌 **Live connection** status
- 🤖 **Self-Improvement Mode** — the agent can inspect, edit, and rebuild its own React UI with 1-click controls in Settings (admin-only)
- 🛡️ **Session Workspace Isolation** — per-chat folder sandboxes (`sessions/<ID>/`) and automatic file cleanup on chat deletion

## Architecture & Security (Production Cloud Edition)

This deployment is hardened for public cloud hosting (Timeweb VDS, Docker, etc.):

### 1. Mandatory Basic Authentication
By default, access to the UI, the REST API, and the WebSocket/SSE streams is protected.
- If you set `OPENCODE_SERVER_PASSWORD` (or `OPENCODE_UI_PASSWORD`) in your environment variables, that password is required (HTTP Basic Auth, user `opencode` by default, override with `OPENCODE_SERVER_USER`) for every request — static assets, `/api/*`, and WebSocket upgrades alike — for as long as nobody has self-registered an account. This single operator is implicitly the admin (see Self-Improvement above).
- If no password environment variable is set, the server automatically generates a secure 16-character hexadecimal password on first startup, prints it to the console, and persists it to `/app/workspace/.admin_password`.
- If you'd rather use multi-user email/password accounts instead of (or in addition to) the shared password, register via the in-app login screen — the first account created becomes admin, and `OPENCODE_ADMIN_EMAILS` can grant admin to specific emails regardless of registration order.
- To access the app without a password in local development, bind the server to `127.0.0.1`.

### 2. Self-Improvement OS-Level Sandbox
In the Settings panel, you can toggle **Self-Improvement Mode**:
- **When ENABLED:** The AI agent has write permissions (`chmod -R u+w`) to `/app/workspace/opencode-ui/` and can modify the UI code or trigger rebuilds.
- **When DISABLED:** The Node server enforces read-only OS permissions (`chmod -R a-w`) on the UI directory. Even if prompt injection occurs, filesystem-level permissions prevent the agent from modifying the web app source code.
- **Rate Limiting:** Endpoints `/api/rebuild` and `/api/reset-ui` are protected by a 10-second cooldown rate limit to prevent DoS.
- **Admin only:** the self-improvement endpoints (`/api/settings/self-improve`, `/api/rebuild`, `/api/reset-ui`, `/api/git/checkpoint(s)`, `/api/git/rollback`) mutate the UI source shared by *every* user of this deployment, so they require an admin account. The first account ever registered on a fresh instance is automatically made admin; you can also grant admin to specific emails via `OPENCODE_ADMIN_EMAILS=alice@example.com,bob@example.com`. In single-operator "password mode" (see below, no self-registered accounts), the operator behind the Basic Auth password is always treated as admin. Any other logged-in user gets a 403 and the Settings panel hides/disables the controls for them.

### 3. Persistent Volume & Data Protection
- OpenCode databases and keys live on the persistent disk (`/app/workspace/.opencode_data/` and `/app/workspace/.config_opencode/`) via symbolic links created in `start.sh`.
- **Note on API Keys:** Provider API keys are saved by OpenCode in `/app/workspace/.opencode_data/auth.json`. Because this file contains sensitive credentials, ensure your Timeweb persistent volume is secured and backed up regularly.
- **Network Isolation:** The background OpenCode server (`opencode serve`) listens strictly on loopback `127.0.0.1:4096`, ensuring it cannot be bypassed or accessed directly from external interfaces.


## How it works

The app calls the OpenCode HTTP API (default base `/api`, proxied to the server to
avoid CORS):

| Action | Endpoint |
| --- | --- |
| List / create / delete sessions | `GET/POST/DELETE /session` |
| Load history | `GET /session/{id}/message` |
| Send a prompt | `POST /session/{id}/prompt` |
| Abort | `POST /session/{id}/abort` |
| Respond to a permission | `POST /session/{id}/permissions/{permissionId}` |
| Real-time updates | `GET /event` (Server-Sent Events) |

Events used: `session.created`, `session.updated`, `session.removed`,
`session.status`, `message.updated`, `message.part.updated`, `permission.asked`,
`permission.responded`.

> Exact field shapes can vary by OpenCode version. Cross-check against the live
> OpenAPI spec served by the server at **`http://localhost:4096/doc`** and adjust
> `src/api/types.ts` if needed.

## Prerequisites

1. **Node.js 18+**
2. **OpenCode** installed — see [opencode.ai/docs](https://opencode.ai/docs/)
3. An authenticated provider, e.g.:
   ```bash
   opencode auth login   # then choose a provider (Anthropic, OpenAI, Copilot, Ollama…)
   ```

## Run

Start the OpenCode headless server in one terminal:

```bash
opencode serve --port 4096 --hostname 127.0.0.1
```

In another terminal, from this folder:

```bash
npm install
npm run dev
```

Open the printed URL (default `http://localhost:5173`). The dev server proxies `/api`
to `http://localhost:4096`, so there are no CORS issues.

### Point at a different server

```bash
OPENCODE_TARGET=http://host:4096 npm run dev
```

### Password-protected server

If you run `OPENCODE_SERVER_PASSWORD=secret opencode serve`, set credentials in
`src/main.tsx` before render:

```ts
import { configure } from "./api/client";
configure({ username: "opencode", password: "secret" });
```

> Note: the browser `EventSource` API can't set headers, so basic auth on the SSE
> stream is only fully supported when the app is served same-origin from the
> OpenCode server (i.e. via `opencode web`'s static serving). For local passworded
> setups, prefer running without the proxy against an absolute same-origin URL.

## Build

```bash
npm run build      # outputs to dist/
npm run preview    # serve the production build
```

The contents of `dist/` are static and can be hosted anywhere (or served by the
OpenCode server itself).

## Project structure

```
src/
├── api/
│   ├── types.ts     # Session / Message / Part / Event types
│   ├── client.ts    # thin REST client over the OpenCode API
│   └── events.ts    # SSE EventStream manager (auto-reconnect)
├── store/
│   └── useStore.ts  # zustand store + event reducer
├── components/
│   ├── Sidebar.tsx          ChatView.tsx     MessageItem.tsx
│   ├── Composer.tsx         StatusBar.tsx    PermissionDialog.tsx
├── App.tsx
├── main.tsx
└── styles.css
```

## Extending it

- **Model picker** — `POST /session/{id}/prompt` accepts `{ model: { providerID, modelID } }`.
  Fetch available models with `GET /config/providers` and wire a `<select>`.
- **Structured output** — pass `{ format: { type: "json_schema", schema } }` to the prompt.
- **Fork / share** — `POST /session/{id}/fork`, `POST /session/{id}/share`.
- **File views** — `GET /file` endpoints to browse the working directory.

## License

MIT — this is an independent community UI. OpenCode is © its respective authors.
