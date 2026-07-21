#!/bin/sh
# Entrypoint изолированного раннера одной сессии.
# Всё состояние (память opencode, конфиг, файлы агента) живёт внутри /session,
# который смонтирован с хоста (<data>/sessions/<sid>). Новый чат = новый каталог =
# новая память, как и раньше.
set -e

echo "=== opencode session runner starting ==="
export HOME=/session/.home
WORK=/session/workspace

mkdir -p "$WORK" "$HOME/.local/share" "$HOME/.config"
mkdir -p /session/.opencode_data /session/.config_opencode

rm -rf "$HOME/.local/share/opencode" "$HOME/.config/opencode"
ln -sfn /session/.opencode_data "$HOME/.local/share/opencode"
ln -sfn /session/.config_opencode "$HOME/.config/opencode"

AUTH_FILE="/session/.opencode_data/auth.json"
CONFIG_FILE="/session/.config_opencode/opencode.jsonc"

if [ -n "$OPENCODE_ZEN_API_KEY" ]; then
  cat > "$AUTH_FILE" <<AUTH_EOF
{
  "opencode": {
    "type": "api",
    "key": "$OPENCODE_ZEN_API_KEY"
  }
}
AUTH_EOF
else
  echo "WARNING: OPENCODE_ZEN_API_KEY not set — no models will be available."
fi

export NOTION_AGENT_HOME="/session/.notionagents"
NOTION_MCP_ENABLED="false"
if [ -f "$NOTION_AGENT_HOME/notion_account.json" ]; then
  NOTION_MCP_ENABLED="true"
fi

cat > "$CONFIG_FILE" <<CONFIG_EOF
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
    },
    "notion": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Notion AI (Bridge)",
      "options": {
        "baseURL": "${NOTION_BRIDGE_URL:-http://opencode-ui:8765/v1}",
        "apiKey": "local"
      },
      "models": {
        "fable-5": { "name": "Fable 5 (Notion)", "limit": { "context": 100000, "output": 40000 } },
        "gpt-5.6-sol": { "name": "GPT-5.6 Sol (Notion)", "limit": { "context": 100000, "output": 40000 } },
        "sonnet-5": { "name": "Sonnet 5 (Notion)", "limit": { "context": 100000, "output": 40000 } },
        "opus-4.8": { "name": "Opus 4.8 (Notion)", "limit": { "context": 100000, "output": 40000 } },
        "grok-4.5": { "name": "Grok 4.5 (Notion)", "limit": { "context": 100000, "output": 40000 } },
        "gemini-3.1-pro": { "name": "Gemini 3.1 Pro (Notion)", "limit": { "context": 100000, "output": 40000 } },
        "gpt-5.4": { "name": "GPT-5.4 (Notion)", "limit": { "context": 100000, "output": 40000 } },
        "gpt-5.2": { "name": "GPT-5.2 (Notion)", "limit": { "context": 100000, "output": 40000 } }
      }
    }
  },
  "mcp": {
    "notion-private": {
      "type": "local",
      "command": ["node", "/app/notioncode_mcp/notion-private-api-mcp/run-from-account.js"],
      "enabled": ${NOTION_MCP_ENABLED},
      "timeout": 10000
    }
  },
  "agent": {
    "coder": {
      "systemPrompt": "Ты — ИИ-ассистент для программирования. Всегда рассуждай на русском языке. Все твои размышления (reasoning/thinking) должны быть на русском языке. Отвечай пользователю на русском языке. Код и технические термины пиши на английском. Ты работаешь в изолированном контейнере этого чата. Твоя рабочая папка — /session/workspace, все файлы создавай только в ней. Свои фоновые процессы (серверы и т.п.) запускай и останавливай по сохранённому PID (kill \$PID); pkill и killall не используй."
    }
  }
}
CONFIG_EOF

echo "Runner workdir: $WORK"
echo "Model: ${OPENCODE_MODEL:-opencode/deepseek-v4-flash-free}"

cd "$WORK"
exec opencode serve --port 4096 --hostname 0.0.0.0
