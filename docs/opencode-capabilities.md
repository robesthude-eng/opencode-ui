# OpenCode capability spike — updated

## Environment

- Observed on the Timeweb production container `opencode-dev-ipv6` (201.51.28.78).
- OpenCode CLI version: `1.17.13`.
- Observation date: 2026-07-14 initial read-only, 2026-07-15 controlled disposable-session experiment.
- Source: 
  - Read-only: `curl http://127.0.0.1:4096/doc` inside container → `/tmp/openapi.json` (478KB, 162 paths)
  - Controlled: disposable sessions `/tmp/opencode-spike-test` and real UI sessions via `http://201.51.28.78:3000/api/*` with cookie auth `opencode_session` + `Origin` header (CSRF guard)
- Test user: `test-spike@example.com` (role user) created via `/api/auth/register`

## Confirmed OpenAPI routes (from /doc)

| Route | Operation ID | Params |
|---|---|---|
| `GET /event` | `event.subscribe` | `directory`, `workspace` (old global bus) |
| `GET /api/event` | `v2.event.subscribe` | none (new global bus) — used by UI `EventStream` |
| `GET /api/session/{sessionID}/event` | `v2.session.events` | `sessionID` path, `after` query string (doc says string, runtime expects integer seq) |
| `GET /session/{sessionID}/message` | `session.messages` | `directory`, `workspace`, `limit`, `before` |
| `POST /session/{sessionID}/message` | `session.prompt` | `directory`, `workspace` query, body: `parts` required, `model`, `agent`, `system`, `tools`, `format`, `variant` optional |
| `POST /experimental/control-plane/move-session` | `experimental.controlPlane.moveSession` | body only |
| `POST /session` | create session | `directory` optional |
| `GET /api/session` | list sessions | — |

## Event transport

### Global bus `/api/event`

**Headers observed:**
```
HTTP/1.1 200
Cache-Control: no-cache, no-transform
Content-Type: text/event-stream
X-Accel-Buffering: no
```

**First event always:**
```
data: {"id":"evt_...","type":"server.connected","properties":{}}
```

**Heartbeat ~ every ~? sec:**
```
data: {"id":"evt_...","type":"server.heartbeat","properties":{}}
```

**Named events (from src/api/events.ts NAMED_TYPES, confirmed via code, not yet captured live in this spike due to instant cached responses):**
```
session.created
session.updated
session.removed
message.updated
message.part.updated
message.part.delta
message.removed
session.status
permission.asked
permission.responded
```
UI subscribes via `new EventSource("/api/event")` and registers listeners for each named type plus `onmessage` fallback.

**Live capture during fast cached reply** (`deepseek-v4-flash-free` with cache read 8320):
- Only `server.connected` + `server.heartbeat` seen when SSE started after message completed or when message completed in <2s (cached).
- Need longer streaming task with unique prompt to trigger `message.part.delta` / `message.part.updated` / `session.status`. Cached replies bypass SSE delta streaming and return final message directly via POST response.

**CSRF:**
- Mutating requests via UI proxy (`/api/*`) require `Origin` header matching host or `Referer`. Without Origin → `403 CSRF check failed (missing origin)` when cookie present. Read with `Cookie: opencode_session=...` + `Origin: http://201.51.28.78:3000` works.

### Session durable event bus `/api/session/{id}/event?after=`

**Spec (from /doc):**
> "Replay durable events after an aggregate sequence, then continue with new durable events." Summary: "Subscribe to session events"

- `after` param in OpenAPI: type string (doc) but runtime validation: `Expected an integer, got NaN at ["after"]` when passing `evt_...` → expects integer sequence number.

**Experiment:**
```
GET /api/session/ses_09c1d22d4ffey9FxxbsDPFMo54/event?after=0

data: {"id":"evt_...","type":"session.next.moved","durable":{"aggregateID":"ses_...","seq":1,"version":1},"data":{"timestamp":...,"sessionID":"...","location":{"directory":"/app/workspace/sessions/.../workspace"},"subdirectory":"..."}}

GET ...?after=1 → (empty, no events)
GET ...?after=1784087200000 → (empty)
GET ...?after=evt_... → 400 InvalidRequestError: Expected an integer, got NaN at ["after"]
```

Conclusion:
- `after` = integer sequence number, 0 = replay from start.
- Returns durable events like `session.next.moved` with `durable.aggregateID`, `seq`, `version`.
- Deterministic replay: after=0 returns seq=1, after=1 returns nothing (only 1 durable event exists for fresh session).
- This is NOT the same as global SSE `Last-Event-ID` replay — it's a separate durable log replay primitive.
- Does NOT support replay by event ID string `evt_...`.

**Not yet captured:** whether global `/api/event` supports `Last-Event-ID` header or `?after=` for replay. Tested `?after=evt_...` on global bus returned `server.connected` (ignored param, not error) — suggests global bus does NOT implement replay via `after`, only `server.connected` on fresh connect.

## Message POST contract

**Endpoint:** `POST /session/{sessionID}/message?directory=/app/workspace/sessions/{id}/workspace`

**Via UI proxy:** `POST /api/session/{id}/message` with `Cookie: opencode_session` + `Origin`.

**Minimal working payload (via proxy):**
```json
{
  "parts": [{"type":"text","text":"Hello, what is 2+2?"}]
}
```
Server fills model from config `opencode.jsonc` → `opencode/deepseek-v4-flash-free` if not specified.

**With model:**
```json
{
  "model": {"providerID":"opencode","modelID":"deepseek-v4-flash-free"},
  "parts": [{"type":"text","text":"hi"}]
}
```

**With system instruction:**
```json
{
  "parts": [{"type":"text","text":"..."}],
  "system": "Ты — ..."
}
```
Spec confirms `system` type string (optional).

**Response:** returns final assistant message object (not streaming) when called via REST:
```json
{
  "info": {"id":"msg_...","role":"assistant","modelID":"deepseek-v4-flash-free","providerID":"opencode",...,"time":{"created":...,"completed":...}},
  "parts": [
    {"type":"step-start",...},
    {"type":"reasoning","text":"..."},
    {"type":"text","text":"4"},
    {"type":"step-finish","reason":"stop",...}
  ]
}
```

If message triggers tools (e.g., write file), parts include `tool` type with `callID`, `tool: "write"`, `state: {status:"completed", input:{filePath, content}, output:...}`.

**Error without provider key:** `UnknownError` with ref `err_...` — check server logs. With valid `OPENCODE_ZEN_API_KEY` (sk-...), works.

## System message field

From OpenAPI `session.prompt` requestBody:
```
system: {type: string} optional
```
UI's `promptWithParts` sends `system` when `systemInstruction` provided. Confirmed string works.

## move-session

Route: `POST /experimental/control-plane/move-session` (no params documented, body only).

Not yet tested with disposable payload — requires understanding body schema from OpenAPI. From doc: `experimental.controlPlane.moveSession` — need to inspect requestBody schema. Leave for next spike. Observed one durable event `session.next.moved` after session creation, which is likely emitted by move-session internally when UI proxy moves session to isolated workspace `/app/workspace/sessions/{id}/workspace`.

## Decision (updated)

- `after` on `/api/session/{id}/event` is integer seq, not event ID, not timestamp. It *does* provide deterministic replay of durable events (session.next.moved). It does NOT replay message part deltas.
- Global `/api/event` currently appears to NOT support `?after=` replay — it returns only `server.connected` + heartbeat on fresh connect, regardless of after param. No `Last-Event-ID` support observed.
- Therefore transport model must remain: global SSE is primary hot-path for `message.part.delta`, `session.status`, etc., but polling `listMessages` every 500ms is required as backstop because SSE has no replay on reconnect. We cannot rely on `after` for message content recovery.
- Do NOT remove polling or introduce custom client event sequence until we capture live streaming `message.part.delta` events with uncached prompt.
- Next spike: send unique uncached prompt (random suffix) with long reasoning/tool calls while SSE listener is already connected (wait for open), to capture `message.part.updated`, `session.status`, `permission.asked`.

## Remaining open questions (from original list)

1. ~~Exact SSE event names~~ — code list known, but live payload shape for `message.part.delta` and `session.status` still needs capture with uncached streaming.
2. ~~Meaning and type of `after`~~ — **answered**: integer seq, durable event replay, not message replay.
3. ~~Whether reconnecting with `after` returns missed events deterministically~~ — **partially answered**: for durable events yes (seq 0 → seq 1), for global message events no.
4. Whether global `/api/event` exposes event IDs or replay semantics — appears NO (returns server.connected only).
5. Exact accepted `system` message field shape — **answered**: string, optional.
6. `move-session` behavior — still needs controlled test with body `{"sessionID": "...", "directory": "..."}` etc.

## Next steps per P0.2

- Run prolonged streaming test with `cache: {read:0}` forced (unique prompt with UUID) to capture `message.part.delta` → update this doc with payload examples.
- Test `POST /experimental/control-plane/move-session` with explicit body to understand if it moves session between workspaces or triggers `session.next.moved`.
- Then close P0.2 and proceed to P0.3 transport/reconciliation module.
