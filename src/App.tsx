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
  // Previously we had per-session stream which was dead (returned empty HTML)
  // Now all per-session requests go to system with ?directory= isolation, so global stream gets everything
  useEffect(() => {
    if (!currentUser) return;
    checkConnection();
    loadSessions();
    loadModels();
    const stream = new EventStream(); // global, no sessionId
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
      <div className="chat empty" style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="muted">Загрузка OpenCode UI…</div>
      </div>
    );
  }

  if (!currentUser) {
    return <LoginPage />;
  }

  const cls = [
    "app",
    workspaceOpen ? "ws-on" : "ws-off",
    sidebarCollapsed ? "sb-off" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls}>
      <Sidebar />
      <main className="main">
        {sidebarCollapsed && (
          <button className="reveal-btn" onClick={toggleSidebar} title="Show chats">
            <MenuIcon size={18} />
          </button>
        )}
        {serverConnected === false && <ConnectionBanner onRetry={checkConnection} />}
        <TopBar />
        <ChatView />
        <Composer />
      </main>
      <Workspace />
      <PermissionDialog />
      <SettingsPanel />
    </div>
  );
}

function ConnectionBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="conn-banner">
      <span className="conn-banner-text">
        <span className="conn-banner-dot" />
        Can't connect to the OpenCode server. Start it with{" "}
        <code>opencode serve</code>
      </span>
      <button className="conn-banner-btn" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
