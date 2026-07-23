import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { api } from "../api/client";
import { messageText } from "../lib/chatText";
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

type DeepHit = { id: string; title: string; snippet: string };

function SidebarUserEmail({ email }: { email: string }) {
  const handleClick = () => {
    if (!navigator.clipboard) {
      toast("error", "Буфер обмена недоступен в этом браузере");
      return;
    }
    navigator.clipboard
      .writeText(email)
      .then(() => toast("success", `Email скопирован: ${email}`))
      .catch(() => toast("error", "Не удалось скопировать email"));
  };

  return (
    <div className="relative flex-1 min-w-0">
      <button
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted transition text-left"
        onClick={handleClick}
        title={`Скопировать email: ${email}`}
        type="button"
      >
        <span className="text-sm shrink-0">👤</span>
        <span className="truncate flex-1 text-muted-foreground">{email}</span>
      </button>
    </div>
  );
}

export default function Sidebar() {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [deepBusy, setDeepBusy] = useState(false);
  const [deepResults, setDeepResults] = useState<DeepHit[] | null>(null);
  const sessions = useStore((s) => s.sessions);
  const currentID = useStore((s) => s.currentID);
  const select = useStore((s) => s.select);
  const newSession = useStore((s) => s.newSession);
  const ensureSelfImproveSession = useStore((s) => s.ensureSelfImproveSession);
  const removeSession = useStore((s) => s.removeSession);
  const pinnedSessions = useStore((s) => s.pinnedSessions);
  const togglePinnedSession = useStore((s) => s.togglePinnedSession);
  const sessionTitleOverrides = useStore((s) => s.sessionTitleOverrides);
  const renameSession = useStore((s) => s.renameSession);

  const normalizedFilter = filter.trim().toLowerCase();
  // Закреплённые чаты всплывают наверх, затем применяется текстовый фильтр.
  const visibleSessions = useMemo(() => {
    const byPin = [...sessions].sort(
      (a, b) =>
        Number(pinnedSessions.includes(b.id)) -
        Number(pinnedSessions.includes(a.id)),
    );
    if (!normalizedFilter) return byPin;
    return byPin.filter((x) =>
      (sessionTitleOverrides[x.id] || x.title || "Новый чат")
        .toLowerCase()
        .includes(normalizedFilter),
    );
  }, [sessions, pinnedSessions, sessionTitleOverrides, normalizedFilter]);

  const commitRename = (id: string) => {
    renameSession(id, editText.trim());
    setEditingId(null);
  };

  // Группировка списка по датам; закреплённые — отдельной секцией сверху.
  const sessionGroupLabel = (x: (typeof sessions)[number]): string => {
    if (pinnedSessions.includes(x.id)) return "\ud83d\udccc Закреплённые";
    const ts = x.time?.updated ?? x.time?.created;
    if (!ts) return "Раньше";
    const day = (d: Date) =>
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diff = Math.round((day(new Date()) - day(new Date(ts))) / 86400000);
    if (diff <= 0) return "Сегодня";
    if (diff === 1) return "Вчера";
    if (diff < 7) return "На этой неделе";
    return "Раньше";
  };
  const groupedSessions: Array<{
    label: string;
    items: typeof visibleSessions;
  }> = [];
  for (const x of visibleSessions) {
    const label = sessionGroupLabel(x);
    const last = groupedSessions[groupedSessions.length - 1];
    if (last && last.label === label) last.items.push(x);
    else groupedSessions.push({ label, items: [x] });
  }

  // Глобальный поиск: грузим сообщения последних сессий и ищем по тексту.
  const runDeepSearch = async () => {
    const q = normalizedFilter;
    if (!q || deepBusy) return;
    setDeepBusy(true);
    try {
      const st = useStore.getState();
      const hits: DeepHit[] = [];
      for (const sess of sessions.slice(0, 30)) {
        const msgs =
          st.messages[sess.id] ??
          (await api.listMessages(sess.id).catch(() => []));
        for (const m of msgs) {
          const t = messageText(m);
          const i = t.toLowerCase().indexOf(q);
          if (i >= 0) {
            hits.push({
              id: sess.id,
              title:
                sessionTitleOverrides[sess.id] || sess.title || "Новый чат",
              snippet: t.slice(Math.max(0, i - 40), i + 60).trim(),
            });
            break;
          }
        }
      }
      setDeepResults(hits);
    } finally {
      setDeepBusy(false);
    }
  };
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

  // Новый запрос в фильтре сбрасывает результаты глубокого поиска.
  useEffect(() => {
    setDeepResults(null);
  }, [normalizedFilter]);

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
              <span>Новый чат</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={close}
              title="Закрыть"
              aria-label="Закрыть меню"
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
        <div className="px-2 pt-2">
          <input
            id="chat-filter-input"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Поиск чатов… (Ctrl+K)"
            aria-label="Поиск по списку чатов"
            className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
          />
          {normalizedFilter && (
            <button
              type="button"
              className="mt-1 w-full rounded-lg border border-dashed border-border px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={runDeepSearch}
              disabled={deepBusy}
            >
              {deepBusy
                ? "Ищу в сообщениях…"
                : "\ud83d\udd0e Искать в сообщениях чатов"}
            </button>
          )}
          {deepResults && (
            <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-border">
              {deepResults.length === 0 && (
                <p className="px-2 py-2 text-[11px] text-muted-foreground">
                  Совпадений в сообщениях нет
                </p>
              )}
              {deepResults.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="block w-full px-2 py-1.5 text-left hover:bg-accent"
                  onClick={() => {
                    select(r.id);
                    close();
                    setDeepResults(null);
                  }}
                >
                  <span className="block truncate text-[11px] text-foreground">
                    {r.title}
                  </span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    …{r.snippet}…
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <ScrollArea className="flex-1 w-full" style={{ width: "100%" }}>
          <nav
            className="space-y-1 p-2"
            style={{ width: "100%", overflowX: "hidden" }}
          >
            {visibleSessions.length === 0 && (
              <p className="px-3 py-8 text-sm text-muted-foreground text-center">
                {normalizedFilter ? "Ничего не найдено" : "Пока нет диалогов"}
              </p>
            )}
            {groupedSessions.map((g) => (
              <div key={g.label}>
                <div className="px-3 pb-1 pt-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                  {g.label}
                </div>
                {g.items.map((s) => {
                  const isActive = s.id === currentID;
                  // The dedicated Self-Improvement chat keeps a stable label so the user
                  // always finds it, even if OpenCode renames the underlying session.
                  const displayTitle =
                    selfImproveEnabled && s.id === selfImproveSessionId
                      ? "🤖 Самоулучшение"
                      : sessionTitleOverrides[s.id] || s.title || "Новый чат";
                  const isPinned = pinnedSessions.includes(s.id);
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
                      {editingId === s.id ? (
                        <input
                          ref={(el) => el?.focus()}
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onBlur={() => commitRename(s.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename(s.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          aria-label="Новое название чата"
                          style={{ flex: 1, minWidth: 0 }}
                          className="mx-2 my-1.5 self-center rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none"
                        />
                      ) : (
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
                                background: "var(--color-success)",
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
                      )}
                      {editingId !== s.id && (
                        <>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              togglePinnedSession(s.id);
                            }}
                            title={isPinned ? "Открепить чат" : "Закрепить чат"}
                            aria-label={`${isPinned ? "Открепить" : "Закрепить"} чат ${displayTitle}`}
                            className={cn(
                              "inline-flex h-8 w-8 shrink-0 self-center items-center justify-center rounded-lg border-none bg-transparent p-0 text-current transition-all duration-150 hover:bg-accent active:scale-90",
                              isPinned
                                ? "opacity-90"
                                : "opacity-45 hover:opacity-100",
                            )}
                          >
                            <span aria-hidden="true">📌</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingId(s.id);
                              setEditText(
                                sessionTitleOverrides[s.id] || s.title || "",
                              );
                            }}
                            title="Переименовать чат"
                            aria-label={`Переименовать чат ${displayTitle}`}
                            className="inline-flex h-8 w-8 shrink-0 self-center items-center justify-center rounded-lg border-none bg-transparent p-0 text-current opacity-45 transition-all duration-150 hover:bg-accent hover:opacity-100 active:scale-90"
                          >
                            <span aria-hidden="true">✏️</span>
                          </button>
                        </>
                      )}
                      {confirmDeleteId === s.id ? (
                        <div className="flex items-center gap-1 bg-red-500/10 rounded-lg mr-1 self-center py-0.5 border border-red-500/20">
                          <span className="text-[11px] font-semibold text-red-500/90 pl-1.5 pr-0.5">
                            Удалить?
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeSession(s.id);
                              setConfirmDeleteId(null);
                            }}
                            title="Подтвердить удаление"
                            className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-red-500 text-white hover:bg-red-600 transition"
                          >
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDeleteId(null);
                            }}
                            title="Отмена"
                            className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-muted hover:bg-muted-foreground/20 text-muted-foreground transition mr-1"
                          >
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(s.id);
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
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
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
              <span>Настройки</span>
              {authedCount > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-auto h-5 px-1.5 text-[11px]"
                >
                  {authedCount}
                </Badge>
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              data-testid="theme-toggle"
              aria-label="Переключить тему"
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
