import * as idb from "idb-keyval";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createAuthSlice } from "./slices/authSlice";
import { createMessagesSlice } from "./slices/messagesSlice";
import { createModelsSlice } from "./slices/modelsSlice";
import { createSessionsSlice } from "./slices/sessionsSlice";
import { createUiSlice } from "./slices/uiSlice";
import type { ModelEntry, State } from "./types";

export type { ModelEntry, State };

/**
 * Prefer IndexedDB via idb-keyval when available; fall back to localStorage.
 * Only UI prefs are persisted (theme, sidebar, last model) — never auth tokens.
 */
function makeStorage() {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    return createJSONStorage(() => localStorage);
  }
  return createJSONStorage(() => ({
    getItem: async (name: string): Promise<string | null> => {
      try {
        const v = await idb.get<string>(name);
        return v ?? null;
      } catch {
        return localStorage.getItem(name);
      }
    },
    setItem: async (name: string, value: string): Promise<void> => {
      try {
        await idb.set(name, value);
      } catch {
        localStorage.setItem(name, value);
      }
    },
    removeItem: async (name: string): Promise<void> => {
      try {
        await idb.del(name);
      } catch {
        localStorage.removeItem(name);
      }
    },
  }));
}

export const useStore = create<State>()(
  persist(
    (...a) => ({
      ...createAuthSlice(...a),
      ...createModelsSlice(...a),
      ...createUiSlice(...a),
      ...createSessionsSlice(...a),
      ...createMessagesSlice(...a),
    }),
    {
      name: "opencode-ui-prefs",
      storage: makeStorage(),
      partialize: (s) => ({
        theme: s.theme,
        sidebarCollapsed: s.sidebarCollapsed,
        workspaceOpen: s.workspaceOpen,
        selectedModel: s.selectedModel,
        pinnedSessions: s.pinnedSessions,
        sessionTitleOverrides: s.sessionTitleOverrides,
      }),
    },
  ),
);
