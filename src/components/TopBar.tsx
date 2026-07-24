import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { buildChatMarkdown, downloadTextFile } from "../lib/chatText";
import { isTmpSession } from "../lib/ids";
import { useStore } from "../store/useStore";
import {
  BashIcon,
  DownloadIcon,
  FolderIcon,
  MenuIcon,
  PreviewIcon,
  SearchIcon,
  SidebarLeftCollapseIcon,
  SidebarLeftExpandIcon,
  WorkspaceClosedIcon,
  WorkspaceOpenIcon,
} from "./icons";
import ModelSelector from "./ModelSelector";
import PanelModal from "./PanelModal";
import { PreviewPanel } from "./PreviewPanel";
import { Terminal } from "./Terminal";

export default function TopBar() {
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const workspaceOpen = useStore((s) => s.workspaceOpen);
  const setWorkspaceOpen = useStore((s) => s.setWorkspaceOpen);
  const selfImproveEnabled = useStore((s) => s.selfImproveEnabled);
  const selfImproveSessionId = useStore((s) => s.selfImproveSessionId);
  const currentID = useStore((s) => s.currentID);
  const testStatus = useStore((s) => s.selfImproveTestStatus);
  const syncSelfImprove = useStore((s) => s.syncSelfImproveFromServer);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const sessionReady = !!currentID && !isTmpSession(currentID);

  // Горячие клавиши: Ctrl/Cmd+K — поиск по списку чатов,
  // Ctrl/Cmd+Shift+O — новый чат. e.code не зависит от раскладки.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.code === "KeyK" && !e.shiftKey) {
        e.preventDefault();
        const st = useStore.getState();
        st.setSidebarOpen(true);
        if (st.sidebarCollapsed) st.setSidebarCollapsed(false);
        setTimeout(() => {
          document.getElementById("chat-filter-input")?.focus();
        }, 50);
      } else if (e.code === "KeyO" && e.shiftKey) {
        e.preventDefault();
        useStore
          .getState()
          .newSession()
          .catch(() => {});
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleExportChat = () => {
    const st = useStore.getState();
    const sid = st.currentID;
    if (!sid) return;
    const msgs = st.messages[sid] ?? [];
    if (msgs.length === 0) {
      toast("info", "В этом чате пока нет сообщений");
      return;
    }
    const title =
      st.sessionTitleOverrides[sid] ||
      st.sessions.find((x) => x.id === sid)?.title ||
      "Чат OpenCode";
    downloadTextFile(
      `opencode-chat-${sid.slice(0, 8)}.md`,
      buildChatMarkdown(msgs, title),
    );
    toast("success", "Чат сохранён в Markdown-файл");
  };

  useEffect(() => {
    if (selfImproveEnabled && currentID === selfImproveSessionId) {
      const id = setInterval(() => {
        // Не опрашиваем сервер из фоновой вкладки — бережём сеть и батарею.
        if (document.visibilityState !== "visible") return;
        syncSelfImprove().catch(() => {});
      }, 5000);
      return () => clearInterval(id);
    }
  }, [selfImproveEnabled, currentID, selfImproveSessionId, syncSelfImprove]);

  return (
    <>
      <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/85 md:px-4">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
          onClick={() => setSidebarOpen(true)}
          title="Меню"
          aria-label="Открыть меню"
        >
          <MenuIcon />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="hidden md:flex h-8 w-8 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={toggleSidebar}
          title={
            sidebarCollapsed
              ? "Показать боковую панель"
              : "Скрыть боковую панель"
          }
          aria-label={
            sidebarCollapsed
              ? "Показать боковую панель"
              : "Скрыть боковую панель"
          }
        >
          {sidebarCollapsed ? (
            <SidebarLeftExpandIcon size={16} />
          ) : (
            <SidebarLeftCollapseIcon size={16} />
          )}
        </Button>

        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="mx-auto shrink-0">
            <ModelSelector />
          </div>
          {selfImproveEnabled && currentID === selfImproveSessionId && (
            <div className="hidden items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 text-[11px] md:flex">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  testStatus === "running"
                    ? "animate-pulse bg-amber-400"
                    : testStatus === "failure"
                      ? "bg-rose-400"
                      : testStatus === "success"
                        ? "bg-emerald-400"
                        : "bg-muted-foreground"
                }`}
              />
              <span className="text-muted-foreground">
                {testStatus === "running"
                  ? "Тесты…"
                  : testStatus === "failure"
                    ? "Ошибки тестов"
                    : testStatus === "success"
                      ? "Готово"
                      : "Готово к работе"}
              </span>
            </div>
          )}
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="hidden h-8 w-8 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 md:inline-flex"
          onClick={handleExportChat}
          disabled={!sessionReady}
          title="Скачать чат в Markdown"
          aria-label="Скачать чат в Markdown"
        >
          <DownloadIcon size={16} />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="hidden h-8 w-8 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 md:inline-flex"
          onClick={() => {
            window.dispatchEvent(new Event("opencode:chat-search"));
          }}
          disabled={!sessionReady}
          title="Поиск по чату (Ctrl+F)"
          aria-label="Поиск по сообщениям чата"
        >
          <SearchIcon size={16} />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
          onClick={() => setShowTerminal(true)}
          disabled={!sessionReady}
          title="Терминал"
          aria-label="Открыть терминал"
        >
          <BashIcon size={16} />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
          onClick={() => setShowPreview(true)}
          disabled={!sessionReady}
          title="Предпросмотр"
          aria-label="Открыть предпросмотр"
        >
          <PreviewIcon size={16} />
        </Button>

        <Button
          variant={workspaceOpen ? "secondary" : "ghost"}
          size="icon"
          className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => setWorkspaceOpen(!workspaceOpen)}
          title="Файлы проекта"
          aria-label="Показать или скрыть файлы проекта"
        >
          {workspaceOpen ? (
            <WorkspaceOpenIcon size={16} />
          ) : (
            <WorkspaceClosedIcon size={16} />
          )}
        </Button>
      </header>

      <PanelModal
        title="Терминал"
        open={showTerminal}
        onClose={() => setShowTerminal(false)}
      >
        <div className="h-full w-full p-2">
          <Terminal workdir={currentID || ""} />
        </div>
      </PanelModal>

      <PanelModal
        title="Предпросмотр"
        open={showPreview}
        onClose={() => setShowPreview(false)}
      >
        <PreviewPanel
          url={currentID ? `/api/sandbox-proxy/${currentID}/` : ""}
        />
      </PanelModal>
    </>
  );
}
