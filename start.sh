#!/bin/sh
set -e

echo "=== OpenCode UI (cloud) starting ==="

WORKDIR="${OPENCODE_WORKDIR:-/app/workspace}"
mkdir -p "$WORKDIR/.opencode_data"
mkdir -p "$WORKDIR/.config_opencode"
mkdir -p "$HOME/.local/share"
mkdir -p "$HOME/.config"

# Cleanup dead files from old buggy deployments that polluted workspace with server files
# Like Claude.ai, workspace should be clean - only sessions, opencode-ui, and essential config
echo "Cleaning up dead files from workspace (like Claude.ai clean workspace)..."
rm -rf "$WORKDIR/.config_opencode_parent" "$WORKDIR/.data_opencode_parent" 2>/dev/null || true
rm -f "$WORKDIR/server.mjs" "$WORKDIR/Dockerfile" "$WORKDIR/package.json" "$WORKDIR/package-lock.json" "$WORKDIR/index.html" "$WORKDIR/railway.json" "$WORKDIR/preview.html" "$WORKDIR/vite.config.ts" "$WORKDIR/vite.config.js" "$WORKDIR/tsconfig.json" "$WORKDIR/tsconfig.node.json" "$WORKDIR/vite.config.d.ts" "$WORKDIR/start.sh" 2>/dev/null || true
rm -rf "$WORKDIR/src" "$WORKDIR/.git" 2>/dev/null || true
rm -f "$WORKDIR/.dockerignore" "$WORKDIR/.env.example" "$WORKDIR/.gitignore" 2>/dev/null || true
# Clean test files created by AI in global workspace (should be in session workspaces, not global)
rm -f "$WORKDIR"/hello.txt "$WORKDIR"/secret*.txt "$WORKDIR"/isolated*.txt "$WORKDIR"/inst*.txt "$WORKDIR"/patched*.txt "$WORKDIR"/about_cat.md "$WORKDIR"/project_isolated.txt "$WORKDIR"/*.md "$WORKDIR"/test*.txt "$WORKDIR"/isolation*.txt "$WORKDIR"/__tests__ 2>/dev/null || true
rm -rf "$WORKDIR"/__tests__ 2>/dev/null || true
# Keep only essential: .opencode_data, .config_opencode, sessions, opencode-ui, .users.json, .sessions.json, etc.
echo "Workspace cleanup done. Current workspace files:"
ls -la "$WORKDIR" | head -n 40

# Symlink OpenCode storage to persistent volume
rm -rf "$HOME/.local/share/opencode" "$HOME/.config/opencode"
ln -sfn "$WORKDIR/.opencode_data" "$HOME/.local/share/opencode"
ln -sfn "$WORKDIR/.config_opencode" "$HOME/.config/opencode"

AUTH_FILE="$HOME/.local/share/opencode/auth.json"
CONFIG_DIR="$HOME/.config/opencode"
CONFIG_FILE="$CONFIG_DIR/opencode.jsonc"

mkdir -p "$WORKDIR"
mkdir -p "$(dirname "$AUTH_FILE")"
mkdir -p "$CONFIG_DIR"

# Copy source code into workspace on first run (for self-improvement)
if [ ! -f "$WORKDIR/opencode-ui/package.json" ]; then
  echo "Copying UI source code into workspace…"
  mkdir -p "$WORKDIR/opencode-ui/src"
  cp -r /app/workspace-src/src/* "$WORKDIR/opencode-ui/src/" 2>/dev/null || true
  cp /app/workspace-src/index.html "$WORKDIR/opencode-ui/" 2>/dev/null || true
  cp /app/workspace-src/package.json "$WORKDIR/opencode-ui/" 2>/dev/null || true
  cp /app/workspace-src/tsconfig.json "$WORKDIR/opencode-ui/" 2>/dev/null || true
  cp /app/workspace-src/tsconfig.node.json "$WORKDIR/opencode-ui/" 2>/dev/null || true
  cp /app/workspace-src/vite.config.ts "$WORKDIR/opencode-ui/" 2>/dev/null || true
  cat > "$WORKDIR/opencode-ui/SELF_IMPROVE.md" <<'GUIDE'
# Self-Improvement Guide
This folder contains your web UI source.
Edit src/ and rebuild: cd /app/workspace/opencode-ui && npm install && npx vite build --outDir /app/dist
GUIDE
  echo "Self-improvement guide created."
fi

# Configure Zen API key
if [ -n "$OPENCODE_ZEN_API_KEY" ]; then
  echo "Configuring OpenCode Zen key…"
  cat > "$AUTH_FILE" <<EOF
{
  "opencode": {
    "type": "api",
    "key": "$OPENCODE_ZEN_API_KEY"
  }
}
EOF
else
  echo "WARNING: OPENCODE_ZEN_API_KEY not set — no models will be available."
fi

# Configure Aerolink
if [ -n "$AEROLINK_API_KEY" ]; then
  echo "Configuring Aerolink key…"
  if [ -f "$AUTH_FILE" ]; then
    node -e "
      const fs = require('fs');
      const f = '$AUTH_FILE';
      let a = {};
      try { a = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
      a.aerolink = { type: 'api', key: '$AEROLINK_API_KEY' };
      fs.writeFileSync(f, JSON.stringify(a, null, 2));
    "
  else
    cat > "$AUTH_FILE" <<AEOF
{
  "aerolink": {
    "type": "api",
    "key": "$AEROLINK_API_KEY"
  }
}
AEOF
  fi
  export ANTHROPIC_API_KEY="$AEROLINK_API_KEY"
  export ANTHROPIC_BASE_URL="https://capi.aerolink.lat"
  echo "Aerolink: key configured"
else
  if [ -f "$AUTH_FILE" ]; then
    AEROLINK_SAVED=$(node -e "
      try {
        const a = JSON.parse(require('fs').readFileSync('$AUTH_FILE', 'utf8'));
        if (a.aerolink && a.aerolink.key) process.stdout.write(a.aerolink.key);
      } catch {}
    " 2>/dev/null)
    if [ -n "$AEROLINK_SAVED" ]; then
      export ANTHROPIC_API_KEY="$AEROLINK_SAVED"
      export ANTHROPIC_BASE_URL="https://capi.aerolink.lat"
      echo "Aerolink: key loaded from auth.json"
    fi
  fi
fi

# Configure model
cat > "$CONFIG_FILE" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "model": "${OPENCODE_MODEL:-opencode/deepseek-v4-flash-free}",
  "provider": {
    "aerolink": {
      "npm": "@ai-sdk/anthropic",
      "name": "Aerolink",
      "options": { "baseURL": "https://capi.aerolink.lat" },
      "models": {
        "claude-opus-4-8": { "displayName": "Claude Opus 4.8", "options": { "reasoningEffort": "high", "thinking": { "type": "enabled" } } },
        "claude-sonnet-4": { "displayName": "Claude Sonnet 4", "options": { "reasoningEffort": "high", "thinking": { "type": "enabled" } } }
      }
    },
    "opencode": {
      "models": {
        "deepseek-v4-flash-free": { "options": { "reasoningEffort": "high", "thinking": { "type": "enabled" } } },
        "big-pickle": { "options": { "reasoningEffort": "high", "thinking": { "type": "enabled" } } },
        "mimo-v2.5-free": { "options": { "reasoningEffort": "high", "thinking": { "type": "enabled" } } },
        "minimax-m2.5-free": { "options": { "reasoningEffort": "high", "thinking": { "type": "enabled" } } },
        "nemotron-3-super-free": { "options": { "reasoningEffort": "medium" } },
        "nemotron-3-ultra-free": { "options": { "reasoningEffort": "high", "thinking": { "type": "enabled" } } },
        "north-mini-code-free": { "options": { "reasoningEffort": "medium" } }
      }
    }
  },
  "agent": {
    "coder": {
      "systemPrompt": "Ты — ИИ-ассистент для программирования. Всегда рассуждай на русском языке. Все твои размышления и рассуждения (reasoning/thinking) должны быть на русском языке. Отвечай пользователю на русском языке. Код и технические термины пиши на английском. ВАЖНО: Каждый чат имеет изолированную папку /app/workspace/sessions/{sessionId}/workspace — всегда используй абсолютные пути внутри этой папки для файлов, чтобы чаты не пересекались, как в Claude.ai. Новый чат = новая память + пустая папка."
    }
  }
}
EOF

echo "Workdir: $WORKDIR"
echo "Model: ${OPENCODE_MODEL:-opencode/deepseek-v4-flash-free}"

# Start UI server
echo "Starting UI server on port 3000…"
cd /app
node server.mjs &
UI_PID=$!
sleep 1

# Start OpenCode system instance
echo "Starting opencode serve on loopback 127.0.0.1:${OC_SYSTEM_PORT:-4096}…"
cd "$WORKDIR"
(
  RESTARTS=0
  while true; do
    opencode serve --port ${OC_SYSTEM_PORT:-4096} --hostname 127.0.0.1
    EXIT_CODE=$?
    RESTARTS=$((RESTARTS+1))
    echo "[ERROR] opencode serve exited with code $EXIT_CODE (restart #$RESTARTS)"
    if [ $RESTARTS -gt 10 ]; then
      echo "[FATAL] Too many restarts, aborting."
      kill -TERM $$ 2>/dev/null || true
      exit 1
    fi
    sleep 3
  done
) &
OC_PID=$!
echo "OpenCode PID: $OC_PID"

trap 'echo "Stopping servers ($UI_PID, $OC_PID)..."; kill -TERM $UI_PID $OC_PID 2>/dev/null || true; exit 0' TERM INT

echo "Waiting for OpenCode server to be ready (TCP check)…"
READY=0
for i in $(seq 1 30); do
  if node -e "const net=require('net'); const s=new net.Socket(); s.setTimeout(1000); s.on('connect',()=>{s.destroy(); process.exit(0)}); s.on('error',()=>process.exit(1)); s.on('timeout',()=>process.exit(1)); s.connect(${OC_SYSTEM_PORT:-4096},'127.0.0.1');" 2>/dev/null; then
    echo "OpenCode is ready (TCP open after ${i}s)"
    READY=1
    break
  fi
  if curl -sf http://127.0.0.1:${OC_SYSTEM_PORT:-4096}/global/health >/dev/null 2>&1; then
    echo "OpenCode is ready (HTTP health after ${i}s)"
    READY=1
    break
  fi
  sleep 1
done

if [ "$READY" = "0" ]; then
  echo "WARNING: OpenCode not ready after 30s, continuing..."
else
  echo "OpenCode system instance is healthy."
fi

wait $UI_PID
