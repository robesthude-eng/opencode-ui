import { useEffect } from "react";
import { useStore } from "./store/useStore";
import { EventStream } from "./api/events";
import { applyTheme } from "./config/theme";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import ChatView from "./components/ChatView";
import Composer from "./components/Composer";
import PermissionDialog from "./components/PermissionDialog";
import SettingsPanel from "./components/SettingsPanel";
import Workspace from "./components/Workspace";
import LoginPage from "./components/LoginPage";
import { MenuIcon } from "./components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function App() {
  const loadSessions = useStore((s) => s.loadSessions);
  const applyEvent = useStore((s) => s.applyEvent);
  const setConnection = useStore((s) => s.setConnection);
  const theme = useStore((s) => s.theme);
  const workspaceOpen = useStore((s) => s.workspaceOpen);
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const loadModels = useStore((s) => s.loadModels);
  const checkConnection = useStore((s) => s.checkConnection);
  const serverConnected = useStore((s) => s.serverConnected);
  const currentUser = useStore((s) => s.currentUser);
  const authChecking = useStore((s) => s.authChecking);
  const checkCurrentUser = useStore((s) => s.checkCurrentUser);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    checkCurrentUser();
  }, [checkCurrentUser]);

  // Single global event stream — system instance emits all session events
  useEffect(() => {
    if (!currentUser) return;
    checkConnection();
    loadSessions();
    loadModels();
    const stream = new EventStream();
    const off = stream.on((e) => applyEvent(e));
    const poll = setInterval(() => setConnection(stream.status), 400);
    const healthPoll = setInterval(() => checkConnection(), 15000);
    const modelsPoll = setInterval(() => loadModels(true), 60000);
    return () => {
      off();
      stream.close();
      clearInterval(poll);
      clearInterval(healthPoll);
      clearInterval(modelsPoll);
    };
  }, [currentUser, loadSessions, loadModels, applyEvent, setConnection, checkConnection]);

  if (authChecking) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Загрузка OpenCode UI…</div>
      </div>
    );
  }

  if (!currentUser) {
    return <LoginPage />;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      {/* Desktop sidebar is hidden via store flag; mobile drawer lives inside Sidebar */}
      {!sidebarCollapsed && <Sidebar />}
      {sidebarCollapsed && (
        // Keep Sidebar mounted so mobile drawer still works when collapsed on desktop
        <div className="md:hidden">
          <Sidebar />
        </div>
      )}

      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {sidebarCollapsed && (
          <Button
            variant="secondary"
            size="icon"
            className="absolute left-3 top-3 z-30 hidden shadow md:flex"
            onClick={toggleSidebar}
            title="Show chats"
          >
            <MenuIcon size={18} />
          </Button>
        )}
        {serverConnected === false && <ConnectionBanner onRetry={checkConnection} />}
        <TopBar />
        <ChatView />
        <Composer />
      </main>

      {workspaceOpen && <Workspace />}
      <PermissionDialog />
      <SettingsPanel />
    </div>
  );
}

function ConnectionBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-amber-500/30",
        "bg-amber-500/10 px-3 py-2 text-sm text-amber-200",
      )}
    >
      <span className="inline-flex items-center gap-2">
        <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
        Can&apos;t connect to the OpenCode server. Start it with{" "}
        <code className="rounded bg-background/40 px-1.5 py-0.5 font-mono text-xs">
          opencode serve
        </code>
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-7 border-amber-500/40 text-amber-100 hover:bg-amber-500/15"
        onClick={onRetry}
      >
        Retry
      </Button>
    </div>
  );
}
