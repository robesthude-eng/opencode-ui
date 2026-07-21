#!/bin/sh
set -e

echo "=== OpenCode UI (cloud) starting ==="

# Increase Node.js memory limit for both UI server and OpenCode backend
export NODE_OPTIONS="--max-old-space-size=4096"

WORKDIR="${OPENCODE_WORKDIR:-/app/workspace}"
mkdir -p "$WORKDIR/.opencode_data"
mkdir -p "$WORKDIR/.config_opencode"
mkdir -p "$HOME/.local/share"
mkdir -p "$HOME/.config"

# Cleanup dead files from old buggy deployments that polluted workspace with server files
echo "Cleaning up dead files from workspace (like Claude.ai clean workspace)..."
rm -rf "$WORKDIR/.config_opencode_parent" "$WORKDIR/.data_opencode_parent" 2>/dev/null || true
rm -f "$WORKDIR/server.mjs" "$WORKDIR/Dockerfile" "$WORKDIR/package.json" "$WORKDIR/package-lock.json" "$WORKDIR/index.html" "$WORKDIR/vite.config.ts" "$WORKDIR/vite.config.js" "$WORKDIR/tsconfig.json" "$WORKDIR/tsconfig.node.json" "$WORKDIR/vite.config.d.ts" "$WORKDIR/start.sh" 2>/dev/null || true
rm -rf "$WORKDIR/src" "$WORKDIR/.git" 2>/dev/null || true
rm -f "$WORKDIR/.dockerignore" "$WORKDIR/.env.example" "$WORKDIR/.gitignore" 2>/dev/null || true
rm -f "$WORKDIR"/hello.txt "$WORKDIR"/secret*.txt "$WORKDIR"/isolated*.txt "$WORKDIR"/inst*.txt "$WORKDIR"/patched*.txt "$WORKDIR"/about_cat.md "$WORKDIR"/project_isolated.txt "$WORKDIR"/*.md "$WORKDIR"/test*.txt "$WORKDIR"/isolation*.txt "$WORKDIR"/__tests__ 2>/dev/null || true
rm -rf "$WORKDIR"/__tests__ 2>/dev/null || true
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

echo "Syncing UI source code from /app/workspace-src/ to $WORKDIR/opencode-ui/…"
mkdir -p "$WORKDIR/opencode-ui/src" "$WORKDIR/opencode-ui/public"
cp -rf /app/workspace-src/src/* "$WORKDIR/opencode-ui/src/" 2>/dev/null || true
if [ -d /app/workspace-src/public ]; then
  cp -rf /app/workspace-src/public/* "$WORKDIR/opencode-ui/public/" 2>/dev/null || true
fi
for f in index.html package.json package-lock.json tsconfig.json tsconfig.node.json vite.config.ts vitest.config.ts biome.json SELF_IMPROVE.md SELF_IMPROVE_GUIDE.md; do
  cp "/app/workspace-src/$f" "$WORKDIR/opencode-ui/" 2>/dev/null || true
done
# Ensure git sees the synced repo as owned by the current user (container user)
# to avoid 'detected dubious ownership' fatal on self-improve operations.
git config --global --add safe.directory "$WORKDIR/opencode-ui" 2>/dev/null || true
if [ ! -f "$WORKDIR/opencode-ui/SELF_IMPROVE.md" ]; then
  cat > "$WORKDIR/opencode-ui/SELF_IMPROVE.md" <<'GUIDE'
# Self-Improvement Guide
Use POST /api/sandbox/apply (admin). Pipeline: Biome → tsc → vitest → vite build.
Then POST /api/rebuild.
GUIDE
fi
echo "Source sync done."

if [ ! -d "$WORKDIR/opencode-ui/.git" ]; then
  echo "Initializing git repo in $WORKDIR/opencode-ui for self-improvement checkpoints…"
  (
    cd "$WORKDIR/opencode-ui" || exit 1
    git init -q
    git config user.email "self-improve@opencode-ui.local"
    git config user.name "OpenCode UI Self-Improvement"
    cat > .gitignore <<'GITIGNORE'
node_modules/
dist/
.vite/
*.log
GITIGNORE
    git add -A
    git commit -q -m "Initial checkpoint (auto-created by start.sh)" --allow-empty || true
  )
  echo "Git repo initialized."
else
  (
    cd "$WORKDIR/opencode-ui" || exit 1
    git config user.email "self-improve@opencode-ui.local" 2>/dev/null || true
    git config user.name "OpenCode UI Self-Improvement" 2>/dev/null || true
    if ! git diff --quiet HEAD -- 2>/dev/null; then
      git add -A
      git commit -q -m "Auto-update from deploy $(date -u +%Y-%m-%dT%H:%M:%SZ)" --allow-empty || true
      echo "Auto-committed deploy update to git."
    fi
  )
fi

if [ -d "$WORKDIR/opencode-ui/.git" ] && ! git -C "$WORKDIR/opencode-ui" remote get-url origin >/dev/null 2>&1; then
  git -C "$WORKDIR/opencode-ui" remote add origin "https://github.com/robesthude-eng/opencode-ui.git"
fi

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

cat > "$CONFIG_FILE" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "model": "${OPENCODE_MODEL:-opencode/deepseek-v4-flash-free}",
  "provider": {
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
      "systemPrompt": "Ты — ИИ-ассистент для программирования. Всегда рассуждай на русском языке. Все твои размышления и рассуждения (reasoning/thinking) должны быть на русском языке. Отвечай пользователю на русском языке. Код и технические термины пиши на английском. ВАЖНО: Каждый чат имеет изолированную папку /app/workspace/sessions/{sessionId}/workspace — всегда используй абсолютные пути внутри этой папки для файлов, чтобы чаты не пересекались, как в Claude.ai. Новый чат = новая память + пустая папка. У тебя есть права sudo без пароля (sudo apt-get update && sudo apt-get install -y ...) и 5 продвинутых суперспособностей для установки ПО ТРЕБОВАНИЮ: 1) Dev-утилиты (ripgrep, jq, sqlite3, gh via sudo apt-get install), 2) Визуальное QA и скриншоты (Chromium в /ms-playwright + Playwright Vision), 3) MCP-серверы (@modelcontextprotocol/server-* via npx), 4) Виртуальный X11/VNC экран (xvfb, x11vnc via sudo apt-get install), 5) Языковые LSP-серверы (typescript-language-server, pyright via npm i -g). Активно предлагай и устанавливай их, когда задача требует глубокого рефакторинга, визуального превью или сложного анализа. Свои фоновые процессы запускай и останавливай по PID (kill \$PID); pkill и killall не используй."
    }
  }
}
EOF

echo "Workdir: $WORKDIR"
echo "Model: ${OPENCODE_MODEL:-opencode/deepseek-v4-flash-free}"

echo "Starting UI server on port 3000…"
cd /app
if [ -f /app/notioncode_mcp/bridge/server.py ]; then
  echo "Starting Notion AI bridge on 0.0.0.0:8765…"
  export NOTION_AGENT_HOME="/root/.notionagents"
  mkdir -p /root/.notionagents
  if [ ! -f /root/.notionagents/models.json ] && [ -f /app/notioncode_mcp/state-template/.notionagents/models.json ]; then
    cp /app/notioncode_mcp/state-template/.notionagents/models.json /root/.notionagents/models.json 2>/dev/null || true
  fi
  /app/.runtime/notion-agent-cli-venv/bin/python -m uvicorn server:app --app-dir /app/notioncode_mcp/bridge --host 0.0.0.0 --port 8765 &
  NOTION_PID=$!
  sleep 1
fi

# Sentry инициализируется первым, до загрузки остальных модулей (--import).
node --import ./server/instrument.mjs server/index.mjs &
UI_PID=$!
sleep 1

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
