import { api } from "../../api/client";
import type { Slice, AuthSlice } from "../types";

// Providers that need custom key handling (not built into OpenCode).
// Previously contained "aerolink", which was removed because it was used to harvest API keys without a legitimate integration.
const CUSTOM_PROVIDERS = new Set<string>();

export const createAuthSlice: Slice<AuthSlice> = (set, get) => ({
  authed: {},
  currentUser: null,
  authChecking: true,

  checkCurrentUser: async () => {
    set({ authChecking: true });
    try {
      const res = await fetch("/api/auth/me", {
        credentials: "include",
        // transitional: still send header if old tab has localStorage token
        headers: {
          "X-Auth-Token":
            typeof window !== "undefined"
              ? localStorage.getItem("opencode_auth_token") || ""
              : "",
        },
      });
      const data = await res.json();
      if (res.ok && data.status === "success" && data.user) {
        set({ currentUser: data.user, authChecking: false });
      } else {
        set({ currentUser: null, authChecking: false });
      }
    } catch {
      set({ currentUser: null, authChecking: false });
    }
  },

  login: async (email, password) => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (res.ok && data.status === "success" && data.user) {
        // Prefer HttpOnly cookie (Set-Cookie from server). Keep localStorage only
        // as EventSource transitional fallback until fully cookie-based SSE.
        if (typeof window !== "undefined" && data.token) {
          localStorage.setItem("opencode_auth_token", data.token);
        }
        set({ currentUser: data.user || { email }, authChecking: false });
        void get().loadSessions();
        void get().loadModels(true);
        return { ok: true };
      }
      return { ok: false, error: data.error || "Ошибка входа" };
    } catch {
      return { ok: false, error: "Ошибка соединения с сервером" };
    }
  },

  register: async (email, password) => {
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (res.ok && data.status === "success" && data.user) {
        if (typeof window !== "undefined" && data.token) {
          localStorage.setItem("opencode_auth_token", data.token);
        }
        set({ currentUser: data.user || { email }, authChecking: false });
        void get().loadSessions();
        void get().loadModels(true);
        return { ok: true };
      }
      return { ok: false, error: data.error || "Ошибка регистрации" };
    } catch {
      return { ok: false, error: "Ошибка соединения с сервером" };
    }
  },

  logout: async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
        headers: {
          "X-Auth-Token":
            typeof window !== "undefined"
              ? localStorage.getItem("opencode_auth_token") || ""
              : "",
        },
      });
    } catch {
      // ignore
    }
    if (typeof window !== "undefined") localStorage.removeItem("opencode_auth_token");
    set({ currentUser: null, sessions: [], currentID: null, messages: {} });
  },

  loadAuth: async () => {
    try {
      const data = await api.listConnected();
      const connected = data.connected ?? [];
      const authed: Record<string, boolean> = {};
      for (const id of connected) authed[id] = true;
      // Also check custom providers stored in auth.json
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
        await api.saveCustomKey(providerId, key);
      } else {
        await api.setAuth(providerId, key);
      }
      set((s) => ({
        authed: { ...s.authed, [providerId]: true },
        modelsLoaded: false,
      }));
      void get().loadModels();
      return true;
    } catch (e) {
      set({ error: (e as Error).message });
      return false;
    }
  },

  removeKey: async (providerId) => {
    try {
      if (CUSTOM_PROVIDERS.has(providerId)) {
        await api.removeCustomKey(providerId);
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
      void get().loadModels();
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },
});
