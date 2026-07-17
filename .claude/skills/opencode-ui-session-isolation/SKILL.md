---
name: opencode-ui-session-isolation
description: "Use BEFORE editing server/index.cjs, src/api/client.ts, src/components/Workspace.tsx, src/store/slices/*, or anything touching chat sessions, files, or the proxy. Documents the per-session workspace-isolation invariants (?directory= passthrough, global routes, Basic Auth gate, admin-only self-improve routes, ownership checks) that MUST NOT be regressed when adding features or refactoring."
---

# Session-Isolation Invariants (do not break these)

These guarantees were deliberately added/fixed. Any edit must preserve them.

## 1. The `?directory=` passthrough
Every per-session request proxied to OpenCode MUST carry
`directory=/app/workspace/sessions/{id}/workspace` so OpenCode only sees that chat's folder.
- `server/index.cjs`: for normal routes, strip `/api` prefix and append `directory=`. For `/event` routes, append `directory=` to the full URL (event endpoint needs the `/api` prefix).
- `DELETE /api/session/:id`: must proxy the delete to OpenCode **with** `directory=` (this was the one route that was missing it — do not reintroduce that bug).
- Global routes (`/api/config/providers`, `/api/provider`, `/api/auth/`, `/api/global/`) and requests with no `sessionId` are proxied WITHOUT `directory=`.

## 2. Session ID extraction & validation
`extractSessionId(req)` checks path `/api/session/{id}`, `?sessionId=`, then header `x-session-id`. `isValidSessionId` rejects `tmp_*` (optimistic client IDs) and enforces `[a-zA-Z0-9_-]{1,128}`. Keep this.

## 3. Frontend must forward sessionId
`src/api/client.ts` `listDir`, `readFile`, `gitStatus` accept `sessionId` and forward `?sessionId=`. `src/components/Workspace.tsx` reads `currentID` from the store and passes it; it must (a) reset the file tree when switching chats, and (b) bail out (show empty state) when no chat is selected (`currentID === null`). Do not hardcode paths or drop the `sessionId` param.

## 4. New chat = empty workspace
`POST /api/session` wipes and recreates `sessions/{id}/workspace` + `uploads/`. Preserve this.

## 5. Delete chat = full cleanup
Server removes `sessions/{id}` and `uploads/{id}` AND proxies the OpenCode delete with `directory=`. Preserve both sides.

## 6. Auth gate
- Single-operator "password mode": if `OPENCODE_SERVER_PASSWORD`/`OPENCODE_UI_PASSWORD` is set and no users registered, the WHOLE app (UI + REST + WS) is gated by HTTP Basic Auth (`checkBasicAuth`, timing-safe). Preserve the gate on both HTTP and the `upgrade` (WebSocket) handler.
- Multi-user mode (any account exists): session-token auth via `checkAuth`. First registered user = admin; also `OPENCODE_ADMIN_EMAILS`.
- Self-improvement routes (`/api/settings/self-improve`, `/api/rebuild`, `/api/reset-ui`, `/api/git/checkpoint`, `/api/git/checkpoints`, `/api/git/rollback`) are ADMIN ONLY — return 403 for non-admins. Never relax this.

## 7. One system instance
There is a single OpenCode instance + a single global event bus. Do not reintroduce a per-session process pool (it broke SSE). Frontend keeps 500ms polling fallback.

## Quick regression checklist after editing
- New chat → empty workspace; old chats unaffected.
- Workspace panel shows ONLY the selected chat's files; switching chats switches the tree.
- No chat selected → empty state, no default/"matryoshka" path.
- Delete chat → folder gone AND OpenCode memory cleared.
- Auth gate still protects UI+API+WS; self-improve routes 403 for non-admins.
