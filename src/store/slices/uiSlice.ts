import { getInitialTheme, applyTheme, type Theme } from "../../config/theme";
import type { Slice, UiSlice } from "../types";

export const createUiSlice: Slice<UiSlice> = (set, get) => ({
  theme: getInitialTheme(),
  settingsOpen: false,
  sidebarOpen: false,
  sidebarCollapsed: false,
  workspaceOpen: typeof window !== "undefined" && window.innerWidth >= 1024,
  selfImproveEnabled: typeof window !== "undefined" && localStorage.getItem("opencode_self_improve") === "true",

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

  setSelfImproveEnabled: (selfImproveEnabled) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("opencode_self_improve", String(selfImproveEnabled));
    }
    set({ selfImproveEnabled });
  },
});
