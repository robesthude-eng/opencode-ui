---
name: opencode-ui-modernize
description: "Use when the user asks to 'modernize', 'upgrade to latest', 'refactor to modern stack', 'improve code quality', or bring opencode-ui up to current best practices. Provides a prioritized, safe upgrade checklist (React 19, Vite 7, TypeScript strict, zustand v5, ESM server modules, Node 22 LTS, unified vitest) using ONLY your built-in knowledge (the environment is OFFLINE — no npm registry, no internet). Preserve the session-isolation and deploy invariants, then deliver the corrected project as a ZIP archive."
---

# Modernize opencode-ui (OFFLINE environment)

**This environment has NO internet access.** You cannot run `npm install`, `npm ci`, `npm view`, reach the npm registry, GitHub, or Railway. You must:
- Make all edits from your own knowledge of current stable releases and best practices (as of your knowledge cutoff).
- NEVER attempt network calls — they will fail and waste turns.
- Preserve ALL invariants in the `opencode-ui-session-isolation` skill.
- Deliver the result as a ZIP (see "Deliverable" below).

## Current stack (from package.json / Dockerfile)
- React 18.3, react-dom 18.3, @types/react 18.3
- Vite 5.4, @vitejs/plugin-react 4.3, TypeScript 5.6
- zustand 4.5
- @tanstack/react-virtual 3.14, react-markdown 9, remark-gfm 4, sql.js 1.14, adm-zip 0.5, http-proxy 1.18
- Node 20 (Dockerfile `node:20-slim`), `opencode-ai@1.17.13`
- Tests: jest (server) + vitest (frontend) — two runners
- Server is CommonJS (`.cjs`) while `package.json` is `"type": "module"` (ESM)

## Prioritized upgrades (apply from knowledge, keep code self-consistent)
| Area | From | Target (stable, offline-known) | Notes |
|---|---|---|---|
| Node runtime | node:20-slim | node:22-slim (LTS) | Node 20 nears EOL; update Dockerfile base + verify `opencode-ai` CLI compat note. |
| React | 18.3 | 19.x | Update `@types/react`/`@types/react-dom`; handle new JSX transform, ref-as-prop (`ReactDOM.createRoot` already used). |
| Vite | 5.4 | 7.x | Update `@vitejs/plugin-react`; check `vite.config.ts` options; `tsc -b` still fine. |
| TypeScript | 5.6 | 5.x (latest) | Enable `"strict": true` if not already; fix resulting type errors. |
| zustand | 4.5 | 5.x | v5 dropped default export + some APIs; update `useStore`/`create` usage in `src/store/*`. |
| @tanstack/react-virtual | 3.14 | 3.x latest (or 4 if available) | Check API changes. |
| Test runner | jest (server) + vitest (frontend) | vitest for both | Convert `server/__tests__` to vitest; delete `jest.config.cjs`, `ts-jest`, `jest-*` deps; unify `npm test`. |
| ESLint | (none/legacy) | ESLint 9 flat config + typescript-eslint | Optional but recommended. |
| Prettier | — | add | Optional formatting baseline. |

When you bump a dependency, update BOTH `package.json` (version range) and the source code that consumes it, so the project stays consistent even though you cannot `npm install` to verify.

## Server module modernization (careful, multi-file)
- `package.json` is already `"type": "module"`, but server files are `.cjs`. Align by converting `server/*.cjs` → `server/*.mjs` (or TypeScript). Coordinated edits required:
  - Replace `require()`/`module.exports` with `import`/`export`.
  - `http-proxy` is CJS — import default: `import httpProxy from 'http-proxy'`.
  - Update `Dockerfile` COPY lines (`server.cjs`→`server.mjs`, `server/*.cjs`→`server/*.mjs`) and the build-time `node -e "require(...)"` check.
  - Update `start.sh` (`node server.cjs` → `node server.mjs`) and the `server.cjs` entrypoint.
- Preserve the ENTIRE proxy/`?directory=` logic verbatim — only the module syntax changes.
- Optionally replace `http-proxy` with Node 22 native `node:http` proxy or `undici` — only if you keep WS support (`systemProxy.ws`) and SSE streaming headers. Otherwise keep `http-proxy`.

## Don't do
- Don't reintroduce a per-session OpenCode process pool.
- Don't drop the `?directory=` param on any per-session route.
- Don't commit tokens or change how credentials are read (see `opencode-ui-orientation`).
- Don't change the Dockerfile's server-module copy list without also updating it (build fails on missing module).
- Don't run `npm install`/`npm ci`/`npm view`/`curl` to external hosts — offline.

## Deliverable (required)
When finished editing, package the whole corrected project as a ZIP for the user to download from chat:
- If it is a git checkout with your changes committed: `git archive --format=zip --output=opencode-ui-fixed.zip HEAD`
- Otherwise, from the project root: `zip -r opencode-ui-fixed.zip . -x 'node_modules/*' -x '.git/*' -x '.env' -x 'uploads/Github.txt'`
- Exclude `node_modules`, `.git`, and any secret files (`.env`, `uploads/Github.txt`).
- Present the zip to the user and give a concise changelog of what you changed and any manual steps they must run (e.g., `npm install` to pull upgraded deps, `npm run build`, then deploy/verify on their side with internet).
- You cannot build or verify the deploy here (no network) — state that clearly and list exactly what the user should verify after deploying.
