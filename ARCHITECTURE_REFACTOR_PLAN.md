# Unified Architecture Refactor Plan — OpenCode UI

**Baseline:** GitHub `main` @ `3f8b0216623955995fba22d67239002fdc89d3df`  
**Product position:** self-hosted/private AI coding workspace for an individual developer or small team—not a general-purpose clone of ChatGPT or Claude.

## Decision

The Claude plan is adopted as the **technical source of truth** because it identifies concrete route, transport, security and test constraints. The ChatGPT plan is adopted for its concise product framing and stage structure.

No major refactor starts until contract tests and OpenCode capability spikes are complete.

## Non-negotiable invariants

1. Every per-session OpenCode request preserves `?directory=` for that session workspace.
2. Global routes and requests without a session ID never receive `directory=`.
3. The application keeps one system OpenCode instance and one global event stream; no per-session process pool returns.
4. Polling remains until reconciliation is implemented and measured.
5. Secrets, databases, uploads, provider keys, `.env`, logs and build artifacts never enter Git or self-improve changes.
6. Self-improve may mutate only validated `src/**` paths and cannot bypass its validation pipeline.
7. Deploy remains: GitHub CI → pinned SSH host key → Timeweb VDS → Docker Compose.

## Important design corrections

### Two separate state machines

Do not mix chat transport state with self-improve release state.

**Per-session transport FSM:**

```text
idle → submitting → running → stale → done | error | aborted | orphaned
```

`stale` is used after loss of liveness; it does not claim the agent is finished.

**Self-improve release FSM:**

```text
proposal → diff → confirmed → applying → checkpointed → building
→ healthcheck → published | rolled_back | failed
```

### SSE and polling

SSE is the primary hot-path writer. Polling is a controlled reconciliation backstop, not an equal writer.

- Poll on reconnect, browser visibility return, online transition and stale liveness state.
- During active streaming, reconciliation may add missing server parts but must not shorten local streaming text.
- Do not assume arbitrary textual delta ordering is commutative. Server sequence/replay support must be proven first.

## P0 execution order

### P0.1 — Contract tests and confirmed security gaps

**Status: in progress**

- Extract pure URL/session/isolation helpers without behavior changes.
- Add deterministic contract tests for `?directory=`, global routes, event routes and DELETE session routing.
- Close every confirmed admin-route gap, including `/api/self-improve/prs` if non-admin access is verified.
- Add route-guard tests before server modularization.

**Acceptance:** removing a `directory=` branch or admin gate makes CI fail.

### P0.2 — OpenCode capability spikes

**Status: partial** — OpenAPI discovery and controlled create/delete probe documented in `docs/opencode-capabilities.md`. Global event IDs/durable sequence confirmed; session-specific replay remains unproven and must not replace global SSE.

Run against a disposable, controlled OpenCode session on the VDS. Document findings in `docs/opencode-capabilities.md`.

1. Event names and payload shape (`session.idle`, `message.part.delta`, `message.updated`).
2. SSE reconnect behavior, event IDs, `Last-Event-ID`, replay and `?since=` support.
3. `POST /session/:id/message` contract and support for server-side system instructions.
4. `move-session` behavior and status codes.

No implementation may depend on an undocumented capability before the relevant spike is complete.

### P0.3 — Transport/reconciliation model

- Add an explicit transport/reconciliation module.
- Replace object-status polling in `router.tsx` with event status callbacks.
- Add reconnect jitter, `lastEventAt`, gap/reconnect reconciliation and rate-limited backstop polling.
- Replace JSON-length merge heuristics with deterministic source-aware merge rules.
- Build a pure reducer and deterministic scenario harness with fake timers.

**Acceptance:** reconnect during a stream converges to server state without duplicate messages, lost attachments or false completion.

### P0.4 — Recoverable per-session FSM

- Move lifecycle state out of module-scope Sets/Maps.
- Persist only bounded per-session lifecycle metadata, never message content.
- Replace the 90-second forced completion with an inactivity watchdog that enters `stale/orphaned`, reconciles server state, and leaves Stop available.
- Restore active session status after browser refresh.

**Acceptance:** a task longer than five minutes is never falsely marked complete; refresh during a run recovers state through reconciliation.

## P1 execution order

### P1.1 — Simplify `messagesSlice.send()`

- Make `send()` request orchestration only.
- Move deterministic merge into a pure module.
- Remove client duplication of server workspace path only after the OpenCode message-contract spike succeeds.

### P1.2 — Modularize server safely

Do this only after P0.1 contract tests.

1. Extract a single `resolveTargetUrl` / isolation module.
2. Extract auth and session routes.
3. Extract self-improve, backups and uploads routes.
4. Leave `server/index.mjs` as bootstrap/orchestration.

No route-body rewrites during extraction. Preserve gate order exactly.

### P1.3 — Self-improve v2 transaction

Replace the current preview-only workflow with:

```text
proposal(files, baseCommit)
→ normalized diff + SHA-256 hash
→ admin confirm(proposalId, hash)
→ exclusive lock
→ verify baseCommit
→ apply
→ checkpoint
→ build
→ healthcheck
→ atomic publish or rollback
```

- Proposal TTL: 15 minutes; proposal is single-use.
- Audit records user, action, proposal hash and file list—not secret-bearing source contents.
- Failed healthcheck must restore the previous published dist.

### P1.4 — Test pyramid and CI

- Unit: FSM, reducer, isolation helpers, merge rules.
- Contract: fake OpenCode upstream with exact route/URL assertions.
- DOM: EventSource/reconcile/store behavior with fake timers.
- E2E: local OpenCode stub, no provider keys or real VDS data.

E2E becomes deploy-blocking only after a stable green history.

## P2

1. Virtualized long-chat rendering, memoized parts and bounded tool output.
2. Raw/debounced streaming markdown; highlight finalized blocks.
3. Diff panel, then artifacts panel.
4. Terminal/log and plan panels only after OpenCode capability spikes prove suitable source events.

## PR discipline

Each PR must contain:

```text
Goal
Files changed
Invariants preserved
Tests
Rollback strategy
Acceptance criteria
```

Rules:

- one architectural stage per PR;
- no merge without green CI;
- inspect CI logs, not only status;
- after merge verify Timeweb commit and `/health`;
- take a database backup and verify dist snapshots before server-refactor or self-improve-v2 PRs.
