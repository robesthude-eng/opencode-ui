import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useStore } from "../store/useStore";
import { CloseIcon } from "./icons";
import { AboutTabContent } from "./settings/AboutTabContent";
import { FreeModelsTabContent } from "./settings/FreeModelsTabContent";
import { ProvidersTabContent } from "./settings/ProvidersTabContent";
import { SelfImproveTabContent } from "./settings/SelfImproveTabContent";
import { useSelfImproveOps } from "./settings/useSelfImproveOps";

type SettingsTab = "self-improve" | "free-models" | "providers" | "about";

const tabs = [
  { id: "self-improve" as const, label: "Саморазвитие", icon: "🤖" },
  { id: "free-models" as const, label: "OpenCode Zen", icon: "🎁" },
  { id: "providers" as const, label: "API Провайдеры", icon: "🔑" },
  { id: "about" as const, label: "О системе", icon: "ℹ️" },
];

const tabTitles: Record<SettingsTab, string> = {
  "self-improve": "Режим саморазвития (Self-Improvement)",
  "free-models": "Бесплатные модели (OpenCode Zen)",
  providers: "Подключение сторонних API провайдеров",
  about: "О системе и архитектуре",
};

/**
 * Thin shell: owns only tab/mobile-nav UI state and the modal shell markup.
 * All domain logic and presentational card markup live in `./settings/*`.
 */
export default function SettingsPanel() {
  const open = useStore((s) => s.settingsOpen);
  const setOpen = useStore((s) => s.setSettingsOpen);
  const loadAuth = useStore((s) => s.loadAuth);

  const [activeTab, setActiveTab] = useState<SettingsTab>("providers");
  // Mobile: "menu" shows nav list; "content" shows selected tab with Back
  const [mobileView, setMobileView] = useState<"menu" | "content">("menu");
  const panelRef = useRef<HTMLDivElement | null>(null);

  const ops = useSelfImproveOps({
    open,
    isActiveTab: activeTab === "self-improve",
  });

  // UX-fix: reset mobileView + reload auth ТОЛЬКО когда open переключается
  // false→true, а НЕ на каждый ре-рендер стора.
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setMobileView("menu");
      loadAuth();
    }
    prevOpenRef.current = open;
  }, [open, loadAuth]);

  // Закрытие по Escape (как у PanelModal) + перенос фокуса внутрь модалки (a11y).
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const tabTitle = tabTitles[activeTab];

  return (
    <div
      className="overlay fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-stretch sm:items-center justify-center p-0 sm:p-4"
      onClick={() => setOpen(false)}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Настройки"
        tabIndex={-1}
        className="bg-background border-0 sm:border border-border rounded-none sm:rounded-xl shadow-lg w-full sm:max-w-5xl h-[100dvh] sm:h-auto sm:max-h-[85vh] flex overflow-hidden outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Desktop sidebar */}
        <aside className="hidden md:flex w-60 border-r border-border bg-muted/20 p-4 flex-col gap-4 shrink-0">
          <div className="flex items-center justify-between px-2">
            <h2 className="text-lg font-semibold">Настройки</h2>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setOpen(false)}
              type="button"
              title="Закрыть"
            >
              <CloseIcon />
            </Button>
          </div>
          <nav className="flex flex-col gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={cn(
                  "flex items-center gap-2 w-full text-left px-3 py-2.5 rounded-xl text-sm transition",
                  activeTab === tab.id
                    ? "bg-muted text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                )}
                onClick={() => setActiveTab(tab.id)}
                aria-current={activeTab === tab.id ? "page" : undefined}
                type="button"
              >
                <span>{tab.icon}</span> {tab.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Mobile: menu list */}
        <div
          className={cn(
            "flex-1 flex-col min-w-0 md:hidden",
            mobileView === "menu" ? "flex" : "hidden",
          )}
        >
          <header className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0 safe-top">
            <h2 className="text-lg font-semibold">Настройки</h2>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => setOpen(false)}
              type="button"
              title="Закрыть"
            >
              <CloseIcon />
            </Button>
          </header>
          <nav className="flex-1 overflow-y-auto p-3 space-y-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3.5 text-left text-[15px] hover:bg-muted/60 active:bg-muted transition"
                onClick={() => {
                  setActiveTab(tab.id);
                  setMobileView("content");
                }}
              >
                <span className="text-lg">{tab.icon}</span>
                <span className="flex-1 font-medium">{tab.label}</span>
                <span className="text-muted-foreground">›</span>
              </button>
            ))}
          </nav>
        </div>

        {/* Content (desktop always; mobile when content view) */}
        <div
          className={cn(
            "flex-1 flex-col min-w-0",
            mobileView === "content" ? "flex" : "hidden md:flex",
          )}
        >
          <header className="flex items-center gap-2 px-3 sm:px-5 py-3 sm:py-4 border-b border-border shrink-0 safe-top">
            <Button
              variant="ghost"
              size="sm"
              className="md:hidden h-9 px-2 shrink-0"
              onClick={() => setMobileView("menu")}
              type="button"
            >
              ← Назад
            </Button>
            <h3 className="font-semibold text-[15px] sm:text-base flex-1 min-w-0 truncate">
              {tabTitle}
            </h3>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={() => setOpen(false)}
              title="Закрыть"
              type="button"
            >
              <CloseIcon />
            </Button>
          </header>

          <div className="flex-1 overflow-y-auto p-4 sm:p-5 pb-10">
            {activeTab === "self-improve" && (
              <SelfImproveTabContent ops={ops} />
            )}
            {activeTab === "free-models" && <FreeModelsTabContent />}
            {activeTab === "providers" && <ProvidersTabContent />}
            {activeTab === "about" && <AboutTabContent />}
          </div>
        </div>
      </div>
    </div>
  );
}
