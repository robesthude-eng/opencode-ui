export type Theme = "light" | "dark";

const KEY = "opencode-ui:theme";

export function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const saved = localStorage.getItem(KEY) as Theme | null;
  if (saved === "light" || saved === "dark") return saved;
  // Respect OS preference on first visit.
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(KEY, theme);
  // Keep the browser chrome (address bar) color in sync.
  const color = theme === "dark" ? "#1a1a1a" : "#ffffff";
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  metas.forEach((m) => m.setAttribute("content", color));
}
