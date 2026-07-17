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
  if (typeof window === "undefined") {
    return createJSONStorage(() => localStorage);
  }
  try {
    // Lazy dynamic shape compatible with zustand StateStorage
    // idb-keyval is sync-ish via promises; zustand persist supports async storage
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return createJSONStorage(() => ({
      getItem: async (name: string) => {
        const { get } = await import("idb-keyval");
        const v = await get(name);
        return (v as string) ?? null;
      },
      setItem: async (name: string, value: string) => {
        const { set } = await import("idb-keyval");
        await set(name, value);
      },
      removeItem: async (name: string) => {
        const { del } = await import("idb-keyval");
        await del(name);
      },
    }));
  } catch {
    return createJSONStorage(() => localStorage);
  }
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
      }),
    },
  ),
);
