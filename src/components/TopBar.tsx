import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useStore } from "../store/useStore";
import {
  BashIcon,
  FolderIcon,
  MenuIcon,
  PreviewIcon,
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
  const sessionReady = !!currentID && !currentID.startsWith("tmp_");

  useEffect(() => {
    if (selfImproveEnabled && currentID === selfImproveSessionId) {
      const id = setInterval(() => {
        void syncSelfImprove();
      }, 5000);
      return () => clearInterval(id);
    }
  }, [selfImproveEnabled, currentID, selfImproveSessionId, syncSelfImprove]);

  return (
    <>
    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b border-[#303030] bg-[#202020]/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-[#202020]/85 md:px-4">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-lg text-[#a0a0a0] hover:bg-[#2b2b2b] hover:text-white md:hidden"
        onClick={() => setSidebarOpen(true)}
        title="Menu"
      >
        <MenuIcon />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="hidden md:flex h-8 w-8 rounded-lg text-[#a0a0a0] hover:bg-[#2b2b2b] hover:text-white"
        onClick={toggleSidebar}
        title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
        aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
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
          <div className="hidden items-center gap-1.5 rounded-lg border border-[#3b3b3b] bg-[#2b2b2b] px-2 py-1 text-[10px] md:flex">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                testStatus === "running"
                  ? "animate-pulse bg-amber-400"
                  : testStatus === "failure"
                    ? "bg-rose-400"
                    : testStatus === "success"
                      ? "bg-emerald-400"
                      : "bg-[#777]"
              }`}
            />
            <span className="text-[#a0a0a0]">
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
        className="h-8 w-8 rounded-lg text-[#a0a0a0] hover:bg-[#2b2b2b] hover:text-white disabled:opacity-40"
        onClick={() => setShowTerminal(true)}
        disabled={!sessionReady}
        title="Terminal"
        aria-label="Open terminal"
      >
        <BashIcon size={16} />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-lg text-[#a0a0a0] hover:bg-[#2b2b2b] hover:text-white disabled:opacity-40"
        onClick={() => setShowPreview(true)}
        disabled={!sessionReady}
        title="Preview"
        aria-label="Open preview"
      >
        <PreviewIcon size={16} />
      </Button>

      <Button
        variant={workspaceOpen ? "secondary" : "ghost"}
        size="icon"
        className="h-8 w-8 rounded-lg text-[#a0a0a0] hover:bg-[#2b2b2b] hover:text-white"
        onClick={() => setWorkspaceOpen(!workspaceOpen)}
        title="Toggle workspace"
        aria-label="Toggle workspace"
      >
        {workspaceOpen ? (
          <WorkspaceOpenIcon size={16} />
        ) : (
          <WorkspaceClosedIcon size={16} />
        )}
      </Button>
    </header>

      <PanelModal title="Terminal" open={showTerminal} onClose={() => setShowTerminal(false)}>
        <div className="h-full w-full p-2">
          <Terminal workdir={currentID || ""} />
        </div>
      </PanelModal>

      <PanelModal title="Preview" open={showPreview} onClose={() => setShowPreview(false)}>
        <PreviewPanel url={currentID ? `/api/sandbox-proxy/${currentID}/` : ""} />
      </PanelModal>
    </>
  );
}
