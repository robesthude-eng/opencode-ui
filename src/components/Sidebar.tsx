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
  const ensureSelfImproveSession = useStore((s) => s.ensureSelfImproveSession);
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
          "fixed md:static inset-y-0 left-0 z-50 w-[min(224px,85vw)] shrink-0",
          "bg-background border-r border-border",
          "flex flex-col h-dvh md:h-full transition-transform duration-200 text-foreground",
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        {/* Top */}
        <div className="flex flex-col gap-2 border-b border-border px-3 pb-3 pt-3">
          <div className="flex items-center gap-2 w-full">
            <Button
              data-testid="new-chat-btn"
              className="h-9 flex-1 justify-start gap-2 rounded-lg border border-transparent bg-transparent text-[12px] font-medium text-primary shadow-none hover:bg-accent hover:border-border"
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
              onClick={close}
              title="Close"
              className="md:hidden"
            >
              <CloseIcon />
            </Button>
          </div>

          {/* Co-designed "Сессия саморазвития" button */}
          {selfImproveEnabled && (
            <Button
              className="h-8 w-full justify-start gap-2 rounded-lg border border-transparent px-2 text-[11px] text-muted-foreground shadow-none hover:bg-accent hover:text-foreground"
              onClick={async () => {
                const sid = await ensureSelfImproveSession();
                if (sid) {
                  select(sid);
                  close();
                }
              }}
            >
              <span className="text-sm shrink-0">✦</span>
              <span className="font-medium text-xs sm:text-sm">
                Сессия саморазвития
              </span>
            </Button>
          )}
        </div>

        {/* Chat list */}
        <ScrollArea className="flex-1 w-full" style={{ width: "100%" }}>
          <nav
            className="space-y-1 p-2"
            style={{ width: "100%", overflowX: "hidden" }}
          >
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
                    "group rounded-lg text-[12px] transition",
                    isActive
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
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
                    className="mr-1 inline-flex h-8 w-8 shrink-0 self-center items-center justify-center rounded-lg border-none bg-transparent p-0 text-current opacity-45 transition-all duration-150 hover:bg-red-500/12 hover:text-red-500 hover:opacity-100 active:scale-90"
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
        <div className="space-y-2 border-t border-border p-3">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              className="h-8 flex-1 justify-start gap-2 rounded-lg px-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsIcon />
              <span>Settings</span>
              {authedCount > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-auto h-5 px-1.5 text-[10px]"
                >
                  {authedCount}
                </Badge>
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              data-testid="theme-toggle"
              onClick={toggleTheme}
              title={`Тема: ${
                theme === "dark"
                  ? "тёмная"
                  : theme === "mid"
                    ? "средняя"
                    : "светлая"
              } — нажмите, чтобы переключить`}
            >
              {theme === "light" ? (
                <MoonIcon />
              ) : theme === "mid" ? (
                <span className="opacity-60 inline-flex">
                  <SunIcon />
                </span>
              ) : (
                <SunIcon />
              )}
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
