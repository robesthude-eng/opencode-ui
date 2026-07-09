import { useState, useRef, useEffect } from "react";
import { useStore } from "../store/useStore";
import { NewChatIcon, SettingsIcon, SunIcon, MoonIcon, TrashIcon, CloseIcon, MenuIcon, LogoutIcon } from "./icons";

function SidebarUserEmail({ email }: { email: string }) {
  const [showFull, setShowFull] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setShowFull(true);
    timerRef.current = setTimeout(() => {
      setShowFull(false);
    }, 5000);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="sidebar-user-wrap">
      {showFull && (
        <div className="sidebar-email-tooltip">
          {email}
        </div>
      )}
      <button
        className="side-action sidebar-user-email"
        onClick={handleClick}
        title="Нажмите, чтобы увидеть полный email"
        type="button"
      >
        <span style={{ fontSize: 13, flexShrink: 0 }}>👤</span>
        <span className="email-text">{email}</span>
      </button>
    </div>
  );
}

export default function Sidebar() {
  const sessions = useStore((s) => s.sessions);
  const currentID = useStore((s) => s.currentID);
  const select = useStore((s) => s.select);
  const newSession = useStore((s) => s.newSession);
  const removeSession = useStore((s) => s.removeSession);
  const status = useStore((s) => s.status);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const currentUser = useStore((s) => s.currentUser);
  const logout = useStore((s) => s.logout);
  const authedCount = Object.keys(useStore((s) => s.authed)).length;

  // On mobile: picking a chat / creating one closes the drawer.
  const close = () => setSidebarOpen(false);

  return (
    <>
      {sidebarOpen && <div className="sidebar-backdrop" onClick={close} />}
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-top">
          <button
            className="new-chat-btn"
            onClick={() => {
              newSession();
              close();
            }}
          >
            <NewChatIcon />
            <span>New chat</span>
          </button>
          <button className="collapse-btn" onClick={toggleSidebar} title="Hide sidebar">
            <MenuIcon size={18} />
          </button>
          <button className="sidebar-close" onClick={close} title="Close">
            <CloseIcon />
          </button>
        </div>

        <nav className="chat-list">
          {sessions.length === 0 && (
            <p className="muted small empty-hint">No conversations yet</p>
          )}
          {sessions.map((s) => (
            <button
              key={s.id}
              className={`chat-item ${s.id === currentID ? "active" : ""}`}
              onClick={() => {
                select(s.id);
                close();
              }}
            >
              <span className="chat-item-title">
                {(typeof status[s.id] === "string" ? status[s.id] : (status[s.id] as any)?.type) === "busy" && <span className="dot pulse" />}
                {s.title || "New chat"}
              </span>
              <span
                className="chat-item-del"
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  removeSession(s.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    removeSession(s.id);
                  }
                }}
                title="Delete"
              >
                <TrashIcon />
              </span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-bottom-row">
            <button className="side-action" onClick={() => setSettingsOpen(true)}>
              <SettingsIcon />
              <span>Settings</span>
              {authedCount > 0 && <span className="key-badge">{authedCount}</span>}
            </button>
            <button className="side-action icon-only" onClick={toggleTheme} title="Toggle theme">
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>

          {currentUser && (
            <div className="sidebar-bottom-row user-row">
              <SidebarUserEmail email={currentUser.email} />
              <button
                className="side-action icon-only"
                style={{ color: "var(--red)" }}
                onClick={() => { if (confirm("Выйти из аккаунта?")) logout(); }}
                title={`Выйти (${currentUser.email})`}
                type="button"
              >
                <LogoutIcon />
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
