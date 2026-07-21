import { api, jsonOrNull } from "../../api/client";
import type { AuthSlice, Slice } from "../types";

/**
 * Тело ответа auth-эндпоинтов. Разбираем через jsonOrNull, чтобы HTML-ответ
 * (SPA-fallback или страница ошибки прокси) не ронял разбор JSON
 * («Unexpected token '<'»), а превращался в пустой объект.
 */
type AuthJson = {
  status?: string;
  user?: NonNullable<AuthSlice["currentUser"]>;
  error?: string;
};

/**
 * Providers whose API keys are persisted in the UI's own database (per-user
 * key file) IN ADDITION to being forwarded to OpenCode. This ensures keys
 * survive Settings panel reopen cycles even when OpenCode's /provider endpoint
 * doesn't echo them back as "connected".
 *
 * Google is included because OpenCode 1.18.x accepts the key (PUT /auth/google
 * returns 200) but does not always report it in GET /provider → connected[],
 * causing the UI to lose the "connected" state on loadAuth() refresh.
 */
const CUSTOM_PROVIDERS = new Set<string>(["google"]);

async function performAuthAction(
  endpoint: string,
  email: string,
  password: string | undefined,
  defaultError: string,
  get: () => any,
  set: (updater: Partial<AuthSlice>) => void,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = ((await jsonOrNull(res)) ?? {}) as AuthJson;
    if (res.ok && data.status === "success" && data.user) {
      if (typeof window !== "undefined") {
        localStorage.removeItem("opencode_auth_token");
      }
      set({ currentUser: data.user || { email }, authChecking: false });
      get()
        .loadSessions()
        .catch((e: unknown) => console.error("[Auth] loadSessions:", e));
      get()
        .loadModels(true)
        .catch((e: unknown) => console.error("[Auth] loadModels:", e));
      return { ok: true };
    }
    return {
      ok: false,
      error: data.error || `${defaultError} (HTTP ${res.status})`,
    };
  } catch {
    return { ok: false, error: "Ошибка соединения с сервером" };
  }
}

export const createAuthSlice: Slice<AuthSlice> = (set, get) => ({
  authed: {},
  currentUser: null,
  authChecking: true,

  checkCurrentUser: async () => {
    set({ authChecking: true });
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      const data = ((await jsonOrNull(res)) ?? {}) as AuthJson;
      if (res.ok && data.status === "success" && data.user) {
        set({ currentUser: data.user, authChecking: false });
      } else {
        set({ currentUser: null, authChecking: false });
      }
    } catch {
      set({ currentUser: null, authChecking: false });
    }
  },

  login: (email, password) =>
    performAuthAction(
      "/api/auth/login",
      email,
      password,
      "Ошибка входа",
      get,
      set,
    ),

  register: (email, password) =>
    performAuthAction(
      "/api/auth/register",
      email,
      password,
      "Ошибка регистрации",
      get,
      set,
    ),

  logout: async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // ignore
    }
    if (typeof window !== "undefined") {
      localStorage.removeItem("opencode_auth_token");
    }
    set({ currentUser: null, sessions: [], currentID: null, messages: {} });
  },

  loadAuth: async () => {
    try {
      const data = await api.listConnected();
      const connected = data.connected ?? [];
      const authed: Record<string, boolean> = {};
      for (const id of connected) authed[id] = true;
      try {
        const custom = await api.listCustomKeys();
        for (const id of custom) authed[id] = true;
      } catch {
        // non-fatal
      }
      set({ authed });
    } catch {
      set({ authed: {} });
    }
  },

  saveKey: async (providerId, key) => {
    try {
      if (CUSTOM_PROVIDERS.has(providerId)) {
        // Persist in the UI's own database so the key survives Settings
        // reopen cycles (loadAuth → GET /provider may not echo it back).
        await api.saveCustomKey(providerId, key);
        // Best-effort: also forward to OpenCode so it can make API calls.
        try {
          await api.setAuth(providerId, key);
        } catch {
          // Non-fatal: key is already saved in the UI DB; OpenCode may
          // not support this provider natively (e.g. needs a plugin).
        }
      } else {
        await api.setAuth(providerId, key);
      }
      set((s) => ({
        authed: { ...s.authed, [providerId]: true },
        modelsLoaded: false,
      }));
      get()
        .loadModels()
        .catch(() => {});
      return true;
    } catch (e) {
      set({ error: (e as Error).message });
      return false;
    }
  },

  removeKey: async (providerId) => {
    try {
      if (CUSTOM_PROVIDERS.has(providerId)) {
        // Remove from UI DB
        await api.removeCustomKey(providerId);
        // Best-effort: also remove from OpenCode
        try {
          await api.removeAuth(providerId);
        } catch {
          // Non-fatal
        }
      } else {
        await api.removeAuth(providerId);
      }
      set((s) => {
        const authed = { ...s.authed };
        delete authed[providerId];
        const selectedModel =
          s.selectedModel?.providerID === providerId ? null : s.selectedModel;
        return { authed, selectedModel, modelsLoaded: false };
      });
      get()
        .loadModels()
        .catch(() => {});
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },
});
