import { Button } from "@/components/ui/button";
import { useStore } from "../store/useStore";
import { MenuIcon, MoonIcon, PanelIcon, SunIcon } from "./icons";
import ModelSelector from "./ModelSelector";

export default function TopBar() {
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const workspaceOpen = useStore((s) => s.workspaceOpen);
  const setWorkspaceOpen = useStore((s) => s.setWorkspaceOpen);

  return (
    <header className="h-14 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-3 md:px-4 flex items-center gap-2 sticky top-0 z-30">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={() => setSidebarOpen(true)}
        title="Menu"
      >
        <MenuIcon />
      </Button>

      <div className="flex-1 min-w-0 flex justify-center">
        <ModelSelector />
      </div>

      <Button
        variant={workspaceOpen ? "secondary" : "ghost"}
        size="icon"
        onClick={() => setWorkspaceOpen(!workspaceOpen)}
        title="Toggle workspace"
      >
        <PanelIcon />
      </Button>
      <Button variant="ghost" size="icon" onClick={toggleTheme} title="Toggle theme">
        {theme === "dark" ? <SunIcon /> : <MoonIcon />}
      </Button>
    </header>
  );
}
