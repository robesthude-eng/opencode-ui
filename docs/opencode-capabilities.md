# OpenCode capability spike

## Environment

- Observed on the Timeweb production container.
- OpenCode CLI version: `1.17.13`.
- Observation date: 2026-07-14.
- Source: local read-only requests to `http://127.0.0.1:4096/doc` and event headers. No provider request or user session was created.

## Confirmed OpenAPI routes

| Route | Operation ID | Observed parameters |
|---|---|---|
| `GET /event` | `event.subscribe` | `directory`, `workspace` |
| `GET /api/event` | `v2.event.subscribe` | none declared |
| `GET /api/session/{sessionID}/event` | `v2.session.events` | `sessionID`, `after` |
| `GET /session/{sessionID}/message` | `session.messages` | `directory`, `workspace`, `limit`, `before` |
| `POST /session/{sessionID}/message` | `session.messages` | session path plus directory/workspace query |
| `POST /experimental/control-plane/move-session` | `experimental.controlPlane.moveSession` | request body only |

`GET /event` returns `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`.

## Important finding

The v2 session-specific event endpoint exposes an `after` query parameter. This is a possible replay/reconciliation primitive and must be evaluated before replacing the current global SSE plus polling transport model.

## Not yet confirmed

The following need a controlled disposable-session experiment before any transport refactor:

1. Exact SSE event names and payloads, including whether `session.idle` is named.
2. Meaning and type of `after`.
3. Whether reconnecting with `after` returns missed events deterministically.
4. Whether the global `/api/event` stream exposes event IDs or replay semantics.
5. Exact accepted `system` message field shape.
6. `move-session` behavior under session creation and restart.

## Decision

Do not remove polling or introduce a custom client event sequence until the controlled replay experiment is complete. The next transport PR must use the observed contract, not assumptions.
