# Self-Improvement Guide

This folder is the source of YOUR web UI — OpenCode UI.

## You CAN improve this UI

1. **Read** `src/` in the assigned session workspace at `/app/workspace/sessions/{sessionId}/workspace`.
2. **Edit** only via sandbox: `POST /api/sandbox/apply` (admin + self-improve on)
3. **Rebuild**: `POST /api/rebuild` after successful deploy from sandbox

The session workspace is a refreshed snapshot of the live project, not the live
`/app/workspace/opencode-ui` directory. An explicit resync refreshes both copies.
The assigned agent may use the scoped `.si-internal-token` only for the documented
internal `create-pr` workflow; never expose that token in chat or logs.

## Architecture

- `src/components/` — React UI (Sidebar, ChatView, Composer, Settings, …)
- `src/components/ui/` — shadcn/Radix primitives
- `src/store/useStore.ts` — Zustand (+ persist for prefs)
- `src/api/client.ts` — API client (**HttpOnly cookie** auth, `credentials: "include"`)
- `src/index.css` — Tailwind 4 tokens (legacy `styles.css` removed)
- `src/router.tsx` — TanStack Router
- `server/` — auth, proxy, sandbox, backups (not sandbox-editable)

## Sandbox pipeline

**Biome → tsc -b → vitest → vite build**

## Access control

ALL self-improve routes are admin-only, enforced centrally in
`server/routes/self-improve.mjs` (the single exception is the read-only
`GET /api/settings/self-improve` status). Non-admins get 403; denials are
written to the audit log.

## Transactions (v2)

`POST /api/self-improve/proposals` → `…/:id/confirm` (hash, 15-min TTL,
single-use) → `…/:id/execute`. Execute runs apply → checkpoint → build →
healthcheck → publish; on any failure the last **published** dist snapshot
is restored automatically (`restoreLatestDist`), so a broken build never
stays live.

## Agent workspace and admin actions

The dedicated Self-Improvement chat receives a filtered snapshot at
`/app/workspace/sessions/<session-id>/workspace`; it is refreshed only when the
administrator runs **Resync**. Reassigning the same chat does not erase its
working files. The agent proposes changes in chat; admin-only PR/proposal
endpoints are invoked by the UI after confirmation because the agent does not
possess the admin HttpOnly cookie.

## Styling

Use Tailwind utilities + shadcn components. Do not reintroduce a large global CSS file.
