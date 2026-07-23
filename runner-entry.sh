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
    "zai": {
      "api": "openai",
      "name": "Z.ai",
      "options": {
        "baseURL": "https://api.z.ai/api/paas/v4"
      },
      "models": {
        "glm-5.2": { "name": "GLM-5.2" },
        "glm-5-turbo": { "name": "GLM-5-Turbo" },
        "glm-4-flash": { "name": "GLM-4-Flash" }
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
exec opencode serve --port 4096 --hostname 0.0.0.0
