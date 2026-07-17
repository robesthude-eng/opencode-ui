#!/bin/bash
set -euo pipefail
cd /home/user/opencode-ui

# Kill old servers if any
pkill -f mock-opencode.mjs 2>/dev/null || true
pkill -f 'node server/index.mjs' 2>/dev/null || true
sleep 1

mkdir -p /tmp/opencode-e2e

# Start mock OpenCode
node e2e/mock-opencode.mjs >/tmp/mock-opencode.log 2>&1 &
MOCK_PID=$!
echo "mock pid: $MOCK_PID"

# Start opencode-ui server
OPENCODE_WORKDIR=/tmp/opencode-e2e OC_SYSTEM_PORT=4096 NODE_ENV=test \
  node server/index.mjs >/tmp/opencode-ui.log 2>&1 &
SERVER_PID=$!
echo "server pid: $SERVER_PID"

cleanup() {
  kill "$SERVER_PID" "$MOCK_PID" 2>/dev/null || true
}
trap cleanup EXIT

# Wait for server health
for i in $(seq 1 30); do
  if curl -fsS -m 2 http://127.0.0.1:3000/health >/dev/null 2>&1; then
    echo "server ready after ${i}s"
    break
  fi
  sleep 1
done

curl -fsS http://127.0.0.1:3000/health; echo

# Register admin
curl -fsS -H 'Content-Type: application/json' \
  --data '{"email":"admin@local.test","password":"testpass123"}' \
  http://127.0.0.1:3000/api/auth/register || echo "register returned $? (user may already exist)"

# Run E2E (chromium only, as in CI)
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npx playwright test e2e/full-ui.spec.ts --project=chromium --reporter=list
