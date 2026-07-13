import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useStore } from "../store/useStore";
import {
  CloseIcon,
  LogoutIcon,
  MenuIcon,
  MoonIcon,
  NewChatIcon,
  SettingsIcon,
  SunIcon,
} from "./icons";

function SidebarUserEmail({ email }: { email: string }) {
  const [showFull, setShowFull] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setShowFull(true);
    timerRef.current = setTimeout(() => setShowFull(false), 5000);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="relative flex-1 min-w-0">
      {showFull && (
        <div className="absolute bottom-full left-0 mb-2 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs shadow-lg z-50 max-w-[240px] break-all">
          {email}
        </div>
      )}
      <button
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted transition text-left"
        onClick={handleClick}
        title="Нажмите, чтобы увидеть полный email"
        type="button"
      >
        <span className="text-sm shrink-0">👤</span>
        <span className="truncate flex-1 text-muted-foreground">{email}</span>
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
  const selfImproveEnabled = useStore((s) => s.selfImproveEnabled);
  const selfImproveSessionId = useStore((s) => s.selfImproveSessionId);

  const close = () => setSidebarOpen(false);

  return (
    <>
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={close}
        />
      )}
      <aside
        className={cn(
          "fixed md:static inset-y-0 left-0 z-50 w-[min(300px,85vw)] shrink-0",
          "bg-card border-r border-border",
          "flex flex-col h-dvh transition-transform duration-200",
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        {/* Top */}
        <div className="flex items-center gap-2 p-3 border-b border-border">
          <Button
            className="flex-1 justify-start gap-2"
            onClick={() => {
              newSession();
              close();
            }}
          >
            <NewChatIcon />
            <span>New chat</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            title="Hide sidebar"
            className="hidden md:flex"
          >
            <MenuIcon size={18} />
          </Button>
          <Button variant="ghost" size="icon" onClick={close} title="Close" className="md:hidden">
            <CloseIcon />
          </Button>
        </div>

        {/* Chat list */}
        <ScrollArea className="flex-1 w-full" style={{ width: "100%" }}>
          <nav className="p-2 space-y-1" style={{ width: "100%", overflowX: "hidden" }}>
            {sessions.length === 0 && (
              <p className="px-3 py-8 text-sm text-muted-foreground text-center">
                No conversations yet
              </p>
            )}
            {sessions.map((s) => {
              const isActive = s.id === currentID;
              // The dedicated Self-Improvement chat keeps a stable label so the user
              // always finds it, even if OpenCode renames the underlying session.
              const displayTitle =
                selfImproveEnabled && s.id === selfImproveSessionId
                  ? "🤖 Самоулучшение"
                  : s.title || "New chat";
              const sStatus =
                typeof status[s.id] === "string"
                  ? status[s.id]
                  : (status[s.id] as { type?: string })?.type;
              const busy = sStatus === "busy";
              return (
                <div
                  key={s.id}
                  className={cn(
                    "group rounded-xl text-sm transition",
                    isActive
                      ? "bg-muted text-foreground"
                      : "hover:bg-muted/60 text-muted-foreground hover:text-foreground",
                  )}
                  style={{
                    width: "100%",
                    maxWidth: "100%",
                    boxSizing: "border-box",
                    display: "flex",
                    alignItems: "stretch",
                    gap: 4,
                    overflow: "hidden",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      select(s.id);
                      close();
                    }}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      paddingLeft: 12,
                      paddingRight: 4,
                      paddingTop: 10,
                      paddingBottom: 10,
                      background: "transparent",
                      border: "none",
                      color: "inherit",
                      font: "inherit",
                      cursor: "pointer",
                      textAlign: "left",
                      borderRadius: 12,
                    }}
                  >
                    {busy && (
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: "#10b981",
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {displayTitle}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Удалить чат «${displayTitle}»?`)) {
                        removeSession(s.id);
                      }
                    }}
                    title="Удалить чат"
                    aria-label={`Удалить чат ${displayTitle}`}
                    style={{
                      flexShrink: 0,
                      alignSelf: "center",
                      width: 32,
                      height: 32,
                      marginRight: 4,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 8,
                      background: "transparent",
                      color: "currentColor",
                      opacity: 0.45,
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                      transition:
                        "background 160ms ease, color 160ms ease, opacity 160ms ease, transform 100ms ease",
                    }}
                    onPointerEnter={(e) => {
                      e.currentTarget.style.background = "rgba(239, 68, 68, 0.12)";
                      e.currentTarget.style.color = "#ef4444";
                      e.currentTarget.style.opacity = "1";
                    }}
                    onPointerLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = "currentColor";
                      e.currentTarget.style.opacity = "0.45";
                    }}
                    onPointerDown={(e) => {
                      e.currentTarget.style.transform = "scale(0.88)";
                      e.currentTarget.style.background = "rgba(239, 68, 68, 0.18)";
                      e.currentTarget.style.color = "#ef4444";
                      e.currentTarget.style.opacity = "1";
                    }}
                    onPointerUp={(e) => {
                      e.currentTarget.style.transform = "scale(1)";
                    }}
                    onPointerCancel={(e) => {
                      e.currentTarget.style.transform = "scale(1)";
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = "currentColor";
                      e.currentTarget.style.opacity = "0.45";
                    }}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M3 6h18" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </nav>
        </ScrollArea>

        {/* Bottom */}
        <div className="border-t border-border p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              className="flex-1 justify-start gap-2"
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsIcon />
              <span>Settings</span>
              {authedCount > 0 && (
                <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-[10px]">
                  {authedCount}
                </Badge>
              )}
            </Button>
            <Button variant="ghost" size="icon" onClick={toggleTheme} title="Toggle theme">
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            </Button>
          </div>

          {currentUser && (
            <>
              <Separator />
              <div className="flex items-center gap-2">
                <SidebarUserEmail email={currentUser.email} />
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10 shrink-0"
                  onClick={() => {
                    if (confirm("Выйти из аккаунта?")) logout();
                  }}
                  title={`Выйти (${currentUser.email})`}
                >
                  <LogoutIcon />
                </Button>
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
