import { applyTheme, getInitialTheme, type Theme } from "../../config/theme";
import type { Slice, UiSlice } from "../types";

export const createUiSlice: Slice<UiSlice> = (set, get) => ({
  theme: getInitialTheme(),
  settingsOpen: false,
  sidebarOpen: false,
  sidebarCollapsed: false,
  // Default closed — opening workspace on every load + self-improve toggle was heavy
  workspaceOpen: false,
  selfImproveEnabled:
    typeof window !== "undefined" && localStorage.getItem("opencode_self_improve") === "true",
  // ID of the dedicated «Самоулучшение» chat created when Self-Improvement is enabled.
  selfImproveSessionId:
    (typeof window !== "undefined"
      ? localStorage.getItem("opencode_self_improve_session")
      : null) as string | null,

  toggleTheme: () => {
    const next: Theme = get().theme === "dark" ? "light" : "dark";
    applyTheme(next);
    set({ theme: next });
  },
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setWorkspaceOpen: (workspaceOpen) => set({ workspaceOpen }),

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
});
