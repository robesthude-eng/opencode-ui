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
    }
  },
  "agent": {
    "coder": {
      "systemPrompt": "Ты — ИИ-ассистент для программирования. Всегда рассуждай на русском языке. Все твои размышления (reasoning/thinking) должны быть на русском языке. Отвечай пользователю на русском языке. Код и технические термины пиши на английском. Ты работаешь в изолированном контейнере этого чата (рабочая папка — /session/workspace). У тебя есть права sudo без пароля (sudo apt-get update && sudo apt-get install -y ...) и 5 продвинутых суперспособностей, которые ты можешь и должен устанавливать и использовать ПО ТРЕБОВАНИЮ задачи: 1) Dev-утилиты (ripgrep, jq, sqlite3, gh): устанавливай через sudo apt-get install -y ripgrep jq sqlite3 gh для поиска по коду, анализа БД и работы с GitHub PR. 2) Визуальное QA и скриншоты UI: Chromium предустановлен в /ms-playwright, запускай npx playwright test или скрипты съемки экрана, чтобы смотреть через зрение (Vision) и исправлять верстку. 3) Протокол MCP: запускай npx -y @modelcontextprotocol/server-... для прямого доступа к базам данных и API. 4) Виртуальный графический экран (Xvfb / noVNC): устанавливай sudo apt-get install -y xvfb x11vnc fluxbox при необходимости запуска GUI-приложений и просмотра в браузере. 5) Семантический анализ кода (AST & LSP): устанавливай npm i -g typescript-language-server pyright для AST-анализа, поиска референсов и типизации. Свои фоновые процессы запускай и останавливай по сохранённому PID (kill \\$PID); pkill и killall не используй."
    }
  }
}
CONFIG_EOF

echo "Runner workdir: $WORK"
echo "Model: ${OPENCODE_MODEL:-opencode/deepseek-v4-flash-free}"

cd "$WORK"
exec opencode serve --port 4096 --hostname 0.0.0.0
