// Popular AI providers that OpenCode supports natively.
// `id` must match the provider id used by OpenCode (POST /auth/{id}).
export interface ProviderInfo {
  id: string;
  name: string;
  color: string; // brand accent
  models: string; // example models
  keyHint: string; // key prefix / shape, for the placeholder
  docsUrl: string;
}

// --- OpenCode Zen free models ---
// These are served through a single OpenCode Zen API key (opencode.ai/auth).
// No per-model setup needed — one key unlocks all of them.
export interface FreeModel {
  id: string; // model id, used as opencode/{id}
  name: string;
  context: string; // context window
  sweBench?: string; // benchmark score
  best: string; // what it's best for
  badge?: string; // tier badge
}

export const ZEN_PROVIDER_ID = "opencode";

export const ZEN_FREE_MODELS: FreeModel[] = [
  {
    id: "deepseek-v4-flash-free",
    name: "DeepSeek V4 Flash Free",
    context: "1M",
    sweBench: "79%",
    best: "Fast & smart — the best all-rounder",
    badge: "S+",
  },
  {
    id: "big-pickle",
    name: "Big Pickle",
    context: "200k",
    sweBench: "72%",
    best: "Daily coding, edits, code review",
    badge: "S+",
  },
  {
    id: "mimo-v2.5-free",
    name: "MiMo-V2.5 Free",
    context: "200k",
    best: "Large codebases, multi-file refactoring",
    badge: "S+",
  },
  {
    id: "minimax-m2.5-free",
    name: "MiniMax M2.5 Free",
    context: "1M",
    best: "Complex reasoning, long context",
    badge: "S+",
  },
  {
    id: "nemotron-3-super-free",
    name: "Nemotron 3 Super Free",
    context: "200k",
    sweBench: "52%",
    best: "Fastest response, quick tasks",
    badge: "A+",
  },
  {
    id: "nemotron-3-ultra-free",
    name: "Nemotron 3 Ultra Free",
    context: "200k",
    best: "Deeper reasoning than Super",
    badge: "A+",
  },
  {
    id: "north-mini-code-free",
    name: "North Mini Code Free",
    context: "200k",
    best: "Compact, efficient coding",
    badge: "A",
  },
];

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "aerolink",
    name: "Aerolink",
    color: "#6366f1",
    models: "Claude Opus 4.8, Sonnet 4",
    keyHint: "aero_live_...",
    docsUrl: "https://aerolink.lat",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    color: "#d97757",
    models: "Claude Opus, Sonnet, Haiku",
    keyHint: "sk-ant-...",
    docsUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "openai",
    name: "OpenAI",
    color: "#10a37f",
    models: "GPT-4o, o1, o3",
    keyHint: "sk-...",
    docsUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "google",
    name: "Google",
    color: "#4285f4",
    models: "Gemini 2.5 Pro/Flash",
    keyHint: "AIza...",
    docsUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "xai",
    name: "xAI",
    color: "#111827",
    models: "Grok 4, Grok Code",
    keyHint: "xai-...",
    docsUrl: "https://console.x.ai",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    color: "#4d6bfe",
    models: "DeepSeek V3, R1",
    keyHint: "sk-...",
    docsUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "groq",
    name: "Groq",
    color: "#f55036",
    models: "Llama, Qwen (fast)",
    keyHint: "gsk_...",
    docsUrl: "https://console.groq.com/keys",
  },
  {
    id: "mistral",
    name: "Mistral",
    color: "#ff7000",
    models: "Mistral Large, Codestral",
    keyHint: "key (32 chars)",
    docsUrl: "https://console.mistral.ai/api-keys",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    color: "#8a3ffc",
    models: "Access to 300+ models",
    keyHint: "sk-or-...",
    docsUrl: "https://openrouter.ai/keys",
  },
  {
    id: "together",
    name: "Together AI",
    color: "#0f6fff",
    models: "Llama, Qwen, DeepSeek",
    keyHint: "tgp_... / ...",
    docsUrl: "https://api.together.ai/settings/api-keys",
  },
  {
    id: "cohere",
    name: "Cohere",
    color: "#39594d",
    models: "Command R+",
    keyHint: "key",
    docsUrl: "https://dashboard.cohere.com/api-keys",
  },
];
