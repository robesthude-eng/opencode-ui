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
USER_KEYS_FILE="/run/user-keys/keys.json"

# Generate auth.json from user keys file (mounted read-only from .user_keys/).
# This function can be called again to reload keys without restarting the container.
generate_auth_json() {
  {
    echo "{"
    FIRST=1

    # Always include OpenCode Zen key from env
    if [ -n "$OPENCODE_ZEN_API_KEY" ]; then
      printf '  "opencode": { "type": "api", "key": "%s" }' "$OPENCODE_ZEN_API_KEY"
      FIRST=0
    fi

    # Read user-connected keys from mounted file
    if [ -f "$USER_KEYS_FILE" ]; then
      # Parse JSON: extract provider_id and key pairs
      # Format: {"google": {"type":"api","key":"..."}, "zai": {"type":"api","key":"..."}}
      KEYS=$(cat "$USER_KEYS_FILE" 2>/dev/null)
      if [ -n "$KEYS" ] && [ "$KEYS" != "{}" ]; then
        # Use node to safely parse and extract keys
        PROVIDER_ENTRIES=$(node -e "
          try {
            const keys = JSON.parse(process.argv[1]);
            const entries = [];
            for (const [id, data] of Object.entries(keys)) {
              if (data && data.key) {
                entries.push('  \"' + id + '\": { \"type\": \"api\", \"key\": \"' + data.key + '\" }');
              }
            }
            process.stdout.write(entries.join(',\n'));
          } catch(e) { process.stdout.write(''); }
        " "$KEYS" 2>/dev/null)

        if [ -n "$PROVIDER_ENTRIES" ]; then
          [ "$FIRST" = "0" ] && echo ","
          printf '%s' "$PROVIDER_ENTRIES"
          FIRST=0
        fi
      fi
    fi

    echo ""
    echo "}"
  } > "$AUTH_FILE"

  if [ "$FIRST" = "1" ]; then
    echo "[auth] WARNING: No API keys available."
  else
    echo "[auth] auth.json generated from user keys file."
  fi
}

# Generate initial auth.json
generate_auth_json

cat > "$CONFIG_FILE" <<CONFIG_EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "model": "${OPENCODE_MODEL:-opencode/deepseek-v4-flash-free}",
  "provider": {
    "zai": {
      "api": "openai",
      "name": "Z.ai",
      "options": {
        "baseURL": "https://api.z.ai/api/paas/v4"
      },
      "models": {
        "glm-4.5-flash": { "name": "GLM-4.5 Flash (Free)" },
        "glm-5.2": { "name": "GLM-5.2" },
        "glm-5-turbo": { "name": "GLM-5-Turbo" },
        "glm-4.5-air": { "name": "GLM-4.5 Air" }
      }
    },
    "openai": {
      "api": "openai",
      "options": {
        "baseURL": "https://browserai-proxy.robesthud.workers.dev/openai/v1"
      },
      "models": {
        "gpt-4o": { "name": "GPT-4o" },
        "gpt-4o-mini": { "name": "GPT-4o Mini" },
        "o3-mini": { "name": "o3 Mini" }
      }
    },
    "anthropic": {
      "api": "anthropic",
      "options": {
        "baseURL": "https://browserai-proxy.robesthud.workers.dev/anthropic"
      },
      "models": {
        "claude-sonnet-4-20250514": { "name": "Claude Sonnet 4" },
        "claude-opus-4-20250514": { "name": "Claude Opus 4" },
        "claude-3-5-haiku-20241022": { "name": "Claude 3.5 Haiku" }
      }
    },
    "xai": {
      "api": "openai",
      "options": {
        "baseURL": "https://browserai-proxy.robesthud.workers.dev/xai/v1"
      },
      "models": {
        "grok-3": { "name": "Grok 3" },
        "grok-3-mini": { "name": "Grok 3 Mini" }
      }
    },
    "deepseek": {
      "api": "openai",
      "options": {
        "baseURL": "https://api.deepseek.com/v1"
      },
      "models": {
        "deepseek-chat": { "name": "DeepSeek V3" },
        "deepseek-reasoner": { "name": "DeepSeek R1" }
      }
    },
    "groq": {
      "api": "openai",
      "options": {
        "baseURL": "https://api.groq.com/openai/v1"
      },
      "models": {
        "llama-3.3-70b-versatile": { "name": "Llama 3.3 70B" },
        "llama-3.1-8b-instant": { "name": "Llama 3.1 8B" }
      }
    },
    "mistral": {
      "api": "openai",
      "options": {
        "baseURL": "https://browserai-proxy.robesthud.workers.dev/mistral/v1"
      },
      "models": {
        "mistral-large-latest": { "name": "Mistral Large" },
        "codestral-latest": { "name": "Codestral" }
      }
    },
    "openrouter": {
      "api": "openai",
      "options": {
        "baseURL": "https://openrouter.ai/api/v1"
      },
      "models": {
        "anthropic/claude-sonnet-4": { "name": "Claude Sonnet 4" },
        "openai/gpt-4o": { "name": "GPT-4o" },
        "google/gemini-2.5-flash": { "name": "Gemini 2.5 Flash" }
      }
    },
    "together": {
      "api": "openai",
      "options": {
        "baseURL": "https://api.together.xyz/v1"
      },
      "models": {
        "meta-llama/Llama-3.3-70B-Instruct-Turbo": { "name": "Llama 3.3 70B" },
        "Qwen/Qwen2.5-Coder-32B-Instruct": { "name": "Qwen 2.5 Coder 32B" }
      }
    },
    "cohere": {
      "api": "openai",
      "options": {
        "baseURL": "https://browserai-proxy.robesthud.workers.dev/cohere/v2"
      },
      "models": {
        "command-r-plus": { "name": "Command R+" },
        "command-r": { "name": "Command R" }
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
      "systemPrompt": "Ты — ИИ-ассистент для программирования. Всегда рассуждай на русском языке. Все твои размышления (reasoning/thinking) должны быть на русском языке. Отвечай пользователю на русском языке. Код и технические термины пиши на английском. Ты работаешь в изолированном контейнере этого чата (рабочая папка — /session/workspace). Работай ТОЛЬКО внутри /session/workspace. Не пытайся читать или изменять файлы за её пределами. Свои фоновые процессы запускай и останавливай по сохранённому PID (kill \$PID); pkill и killall не используй."
    }
  }
}
CONFIG_EOF

echo "Runner workdir: $WORK"
echo "Model: ${OPENCODE_MODEL:-opencode/deepseek-v4-flash-free}"

cd "$WORK"

# Run opencode serve in a loop so it auto-restarts on kill.
# SIGHUP triggers a key reload (regenerate auth.json) before restart.
OPENCODE_PID=""
RELOAD_KEYS=0

trap 'RELOAD_KEYS=1; [ -n "$OPENCODE_PID" ] && kill "$OPENCODE_PID" 2>/dev/null' HUP
trap '[ -n "$OPENCODE_PID" ] && kill "$OPENCODE_PID" 2>/dev/null; exit 0' TERM INT

while true; do
  if [ "$RELOAD_KEYS" = "1" ]; then
    echo "[runner] SIGHUP received — reloading keys..."
    generate_auth_json
    RELOAD_KEYS=0
  fi

  opencode serve --port 4096 --hostname 0.0.0.0 &
  OPENCODE_PID=$!
  echo "[runner] opencode serve started (PID $OPENCODE_PID)"
  wait "$OPENCODE_PID" 2>/dev/null
  EXIT_CODE=$?
  OPENCODE_PID=""
  echo "[runner] opencode serve exited (code $EXIT_CODE) — restarting in 1s..."
  sleep 1
done
