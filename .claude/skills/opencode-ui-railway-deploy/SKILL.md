---
name: opencode-ui-railway-deploy
description: "Use when deploying opencode-ui to Railway, pushing a fix, or verifying that a deploy succeeded. Documents the commit to main, push, auto-deploy, and GraphQL verification flow; the constraint of using only environment tools (git, curl, jq, python3 — no gh or railway CLI); and how to read credentials at runtime without committing secrets."
---

# Deploying opencode-ui to Railway

> **OFFLINE NOTE:** Verifying deploys via the Railway GraphQL API requires internet. In an offline assistant environment you CANNOT do this — skip verification, just produce the corrected code as a ZIP (see `opencode-ui-modernize`) and tell the user to deploy/verify on their side. This skill is reference material for the deploy step that runs with network access.

## Flow
1. Make the change locally in the clone.
2. `git add -A && git commit -m "..."` then `git push origin main`.
3. Railway auto-builds (Dockerfile) and deploys to the `production` environment.
4. Wait ~90s, then verify the latest deployment status via the Railway GraphQL API.
5. Confirm the feature behaves correctly (isolation, delete, empty state).

## Available tools (constraint)
Only these are guaranteed: `git`, `curl`, `jq`, `python3`. Do NOT assume `gh` or `railway` CLI exist.

## Credentials at runtime
Read from `uploads/Github.txt` (lines: `гитхаб <token>`, `раилвэй <token>`, `ID проекта: <uuid>`). Export into shell vars, never write to files.

```sh
GH_TOKEN=$(grep '^гитхаб' uploads/Github.txt | awk '{print $2}')
RW_TOKEN=$(grep '^раилвэй' uploads/Github.txt | awk '{print $2}')
PROJECT_ID=$(grep 'ID проекта' uploads/Github.txt | awk '{print $2}')
```

If the repo was cloned with the token in the URL, strip it:
```sh
git remote set-url origin "https://github.com/robesthude-eng/opencode-ui.git"
```

## Verify deploy via GraphQL
Railway v2 endpoint: `https://backboard.railway.app/graphql/v2`
Header: `Authorization: Bearer $RW_TOKEN`

List deployments (input has NO `first` field):
```graphql
query($input: DeploymentListInput!) {
  deployments(input: $input) {
    deployments { id status createdAt metadata { githubCommitSha } }
  }
}
```
variables: `{ "input": { "projectId": "<PROJECT_ID>", "environmentId": "<ENV_ID>", "serviceId": "<SERVICE_ID>" } }`

Status values include `SUCCESS`, `FAILED`, `BUILDING`, `DEPLOYING`, `CRASHED`. Look at the newest deployment's `status` and `metadata.githubCommitSha` to confirm it matches your push.

Fetch build/runtime logs:
```graphql
query($id: String!) { buildLogs(deploymentId: $id, limit: 200) { message severity timestamp } }
query($id: String!) { deploymentLogs(deploymentId: $id, limit: 200) { message severity timestamp } }
```
(Select only `{ message severity timestamp }`; `attributes`/`tags` need subfields.)

Use `curl -s -X POST "$URL" -H "Authorization: Bearer $RW_TOKEN" -H "Content-Type: application/json" -d '{"query":"...","variables":{...}}' | jq`.

## Service identifiers (reference)
- Project `opencode-ui`, service `opencode-ui`, env `production`.
- Public domain: `opencode-ui-production.up.railway.app`, healthcheck `/health`.
