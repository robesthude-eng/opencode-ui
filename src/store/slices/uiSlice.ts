import { api, jsonOrNull } from "../../api/client";
import {
  applyTheme,
  getInitialTheme,
  nextTheme,
  type Theme,
} from "../../config/theme";
import { isTmpSession } from "../../lib/ids";
import type { Slice, UiSlice } from "../types";

export const createUiSlice: Slice<UiSlice> = (set, get) => ({
  theme: getInitialTheme(),
  settingsOpen: false,
  sidebarOpen: false,
  sidebarCollapsed: false,
  // Default closed — opening workspace on every load + self-improve toggle was heavy
  workspaceOpen: false,
  selfImproveEnabled:
    typeof window !== "undefined" &&
    localStorage.getItem("opencode_self_improve") === "true",
  // ID of the dedicated «Самоулучшение» chat created when Self-Improvement is enabled.
  selfImproveSessionId: (typeof window !== "undefined"
    ? localStorage.getItem("opencode_self_improve_session")
    : null) as string | null,
  selfImproveTestStatus: "idle",
  selfImproveTestErrors: [],
  pinnedSessions: [],
  sessionTitleOverrides: {},

  toggleTheme: () => {
    // тёмная → средняя → светлая → тёмная
    const next: Theme = nextTheme(get().theme);
    applyTheme(next);
    set({ theme: next });
  },
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setWorkspaceOpen: (workspaceOpen) => set({ workspaceOpen }),

  togglePinnedSession: (id) =>
    set((s) => ({
      pinnedSessions: s.pinnedSessions.includes(id)
        ? s.pinnedSessions.filter((x) => x !== id)
        : [...s.pinnedSessions, id],
    })),

  // Переименование — клиентский оверлей над серверным заголовком:
  // пустая строка убирает оверлей и возвращает исходное название.
  renameSession: (id, title) => {
    const prev = get().sessionTitleOverrides[id];
    // Оптимистично показываем новое имя сразу…
    set((s) => {
      const overrides = { ...s.sessionTitleOverrides };
      if (title) overrides[id] = title;
      else delete overrides[id];
      return { sessionTitleOverrides: overrides };
    });
    // …и сохраняем на сервере, чтобы название было видно с любого
    // устройства. Оптимистичные tmp_-сессии на сервере ещё не существуют.
    if (isTmpSession(id)) return;
    api.renameSession(id, title).catch(() => {
      // Сервер недоступен — откатываем к прежнему имени.
      set((s) => {
        const overrides = { ...s.sessionTitleOverrides };
        if (prev !== undefined) overrides[id] = prev;
        else delete overrides[id];
        return { sessionTitleOverrides: overrides };
      });
    });
  },

  setSelfImproveSessionId: (id) => {
    if (typeof window !== "undefined") {
      if (id) localStorage.setItem("opencode_self_improve_session", id);
      else localStorage.removeItem("opencode_self_improve_session");
    }
    set({ selfImproveSessionId: id });
  },

  setSelfImproveEnabled: (selfImproveEnabled) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("opencode_self_improve", String(selfImproveEnabled));
    }
    set({ selfImproveEnabled });
  },

  // UX-fix: pull actual server state on app load; localStorage can drift out of sync
  // (e.g. admin toggled from another device or state was reset server-side).
  syncUserPrefsFromServer: () => {
    console.log("sync prefs");
  },
  syncSelfImproveFromServer: async () => {
    try {
      const res = await fetch("/api/settings/self-improve", {
        credentials: "include",
      });
      if (!res.ok) return;
      // jsonOrNull: HTML-ответ (SPA-fallback / прокси) → тихо выходим,
      // вместо «SyntaxError: Unexpected token '<'» из res.json().
      const data = (await jsonOrNull(res)) as {
        enabled?: boolean;
        sessionId?: string | null;
        testStatus?: "idle" | "running" | "success" | "failure";
        testErrors?: string[];
      } | null;
      if (!data) return;
      const enabled = !!data.enabled;
      const sessionId = data.sessionId || null;
      const testStatus = data.testStatus || "idle";
      const testErrors = data.testErrors || [];
      if (typeof window !== "undefined") {
        localStorage.setItem("opencode_self_improve", String(enabled));
        if (sessionId)
          localStorage.setItem("opencode_self_improve_session", sessionId);
        else localStorage.removeItem("opencode_self_improve_session");
      }
      set({
        selfImproveEnabled: enabled,
        selfImproveSessionId: sessionId,
        selfImproveTestStatus: testStatus,
        selfImproveTestErrors: testErrors,
      });
    } catch (_e) {
      /* silent */
    }
  },
});
