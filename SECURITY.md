# Security notes — OpenCode UI

## Secrets rotation (URGENT if tokens were shared)

If a GitHub PAT or Railway token was pasted into chat, files, or logs:

1. **GitHub** → Settings → Developer settings → Personal access tokens → **Revoke** the exposed token → create a new one with minimal scopes (`repo` only if needed).
2. **Railway** → Account → Tokens → **Revoke** the exposed token → create a new project token.
3. Update local secrets stores / CI secrets only — never commit tokens.
4. Prefer GitHub Actions secrets + Railway Variables; never put tokens in the repo.

## Password pepper

Set once in Railway Variables and keep forever (changing invalidates only if you don't keep legacy verify — current code still verifies unpeppered hashes):

```
OPENCODE_PASSWORD_PEPPER=<long-random-32+-chars>
```

New passwords are stored as `v2:salt:hash` (HMAC-SHA256 pepper → scrypt).

## Session cookies

- Cookie name: `opencode_session`
- Flags: `HttpOnly; SameSite=Lax; Secure` (prod/Railway)
- CSRF: Origin/Referer check on cookie-authenticated mutating requests

## Data location

| Data | Path |
|---|---|
| Auth DB | `$OPENCODE_WORKDIR/opencode.db` |
| DB backups | `$OPENCODE_WORKDIR/backups/opencode-*.db` (daily + manual) |
| Dist snapshots | `/app/dist-versions/` (instant UI rollback) |
| Session workspaces | `$OPENCODE_WORKDIR/sessions/<id>/workspace` |

## Admin recovery order

1. **Instant UI rollback** (Settings → Саморазвитие) — previous build, no rebuild  
2. **Git rollback** — source + rebuild  
3. **Factory reset** — restore factory sources + rebuild  
4. **DB backup** — create before risky migrations  

## Reporting

Treat this deployment as private multi-tenant until rate limits, backups, and secret rotation are verified.
