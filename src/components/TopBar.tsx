import { useStore } from "../store/useStore";
import { SunIcon, MoonIcon, MenuIcon, PanelIcon } from "./icons";
import ModelSelector from "./ModelSelector";

export default function TopBar() {
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const workspaceOpen = useStore((s) => s.workspaceOpen);
  const setWorkspaceOpen = useStore((s) => s.setWorkspaceOpen);

  return (
    <header className="topbar">
      <button
        className="icon-btn hamburger"
        onClick={() => setSidebarOpen(true)}
        title="Menu"
      >
        <MenuIcon />
      </button>
      <div className="topbar-model">
        <ModelSelector />
      </div>
      <button
        className={`icon-btn ${workspaceOpen ? "active" : ""}`}
        onClick={() => setWorkspaceOpen(!workspaceOpen)}
        title="Toggle workspace"
      >
        <PanelIcon />
      </button>
      <button className="icon-btn" onClick={toggleTheme} title="Toggle theme">
        {theme === "dark" ? <SunIcon /> : <MoonIcon />}
      </button>
    </header>
  );
}
