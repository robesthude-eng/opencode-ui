import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useStore } from "../store/useStore";
import { CloseIcon, SearchIcon } from "./icons";
import { AboutTabContent } from "./settings/AboutTabContent";
import { AppearanceTabContent } from "./settings/AppearanceTabContent";
import { ModelsTabContent } from "./settings/ModelsTabContent";
import { SelfImproveTabContent } from "./settings/SelfImproveTabContent";
import { useSelfImproveOps } from "./settings/useSelfImproveOps";

type SettingsTab = "appearance" | "models" | "self-improve" | "about";

type TabDef = {
  id: SettingsTab;
  label: string;
  title: string;
  /** Синонимы и ключевые слова раздела для поиска по настройкам. */
  keywords: string;
  /** Раздел виден только администратору. */
  adminOnly?: boolean;
};

type TabGroup = { label: string; items: TabDef[] };

/**
 * Реестр разделов настроек, сгруппированный по смыслу:
 * Аккаунт · Чат · Администрирование · Справка.
 *
 * Как добавить раздел (например «Настройки чата» в группу «Чат»
 * или «Подключение MCP» новой группой «Подключения»):
 * 1. Расширьте тип SettingsTab новым id.
 * 2. Добавьте TabDef в нужную группу (label — пункт меню,
 *    title — заголовок страницы, keywords — слова для поиска).
 * 3. Соберите контент из атомов ./settings/primitives.tsx
 *    (SettingsSection, SettingsRow) и подключите в блоке рендера
 *    контента внизу этого файла.
 */
const TAB_GROUPS: TabGroup[] = [
  {
    label: "Аккаунт",
    items: [
      {
        id: "appearance",
        label: "Внешний вид",
        title: "Внешний вид",
        keywords: "тема цвет тёмная светлая средняя оформление theme dark light",
      },
    ],
  },
  {
    label: "Чат",
    items: [
      {
        id: "models",
        label: "Модели",
        title: "Модели и API-ключи",
        keywords:
          "модели бесплатные ключ провайдеры zen api byok free models providers openai anthropic openrouter",
      },
    ],
  },
  {
    label: "Администрирование",
    items: [
      {
        id: "self-improve",
        label: "Саморазвитие",
        title: "Режим саморазвития (Self-Improvement)",
        keywords:
          "саморазвитие бэкап чекпоинт откат сброс сервер логи git self-improve rollback backup",
        adminOnly: true,
      },
    ],
  },
  {
    label: "Справка",
    items: [
      {
        id: "about",
        label: "О системе",
        title: "О системе и архитектуре",
        keywords: "версия стек архитектура справка about version",
      },
    ],
  },
];

const ALL_TABS: TabDef[] = TAB_GROUPS.flatMap((g) => g.items);

/**
 * Thin shell: owns only nav/search/mobile UI state and the modal markup.
 * All domain logic and presentational card markup live in `./settings/*`.
 */
export default function SettingsPanel() {
  const open = useStore((s) => s.settingsOpen);
  const setOpen = useStore((s) => s.setSettingsOpen);
  const loadAuth = useStore((s) => s.loadAuth);

  const [activeTab, setActiveTab] = useState<SettingsTab>("models");
  const [query, setQuery] = useState("");
  // Mobile: "menu" shows nav list; "content" shows selected tab with Back
  const [mobileView, setMobileView] = useState<"menu" | "content">("menu");
  const panelRef = useRef<HTMLDivElement | null>(null);

  const ops = useSelfImproveOps({
    open,
    isActiveTab: activeTab === "self-improve",
  });
  const isAdminUser = ops.isAdminUser;

  // UX-fix: reset mobileView/search + reload auth ТОЛЬКО когда open переключается
  // false→true, а НЕ на каждый ре-рендер стора.
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setMobileView("menu");
      setQuery("");
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

  // Группы меню: скрываем админские разделы у обычных пользователей
  // и фильтруем по поисковому запросу (label + title + keywords).
  const visibleGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TAB_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter(
        (t) =>
          (!t.adminOnly || isAdminUser) &&
          (!q ||
            t.label.toLowerCase().includes(q) ||
            t.title.toLowerCase().includes(q) ||
            t.keywords.includes(q)),
      ),
    })).filter((g) => g.items.length > 0);
  }, [query, isAdminUser]);

  if (!open) return null;

  const tabTitle = ALL_TABS.find((t) => t.id === activeTab)?.title ?? "";

  const searchBox = (
    <div className="relative">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
        <SearchIcon size={14} />
      </span>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Поиск настроек"
        aria-label="Поиск по настройкам"
        className="h-8 pl-8 text-sm"
      />
    </div>
  );

  const emptyResults = (
    <p className="px-3 py-2 text-xs text-muted-foreground">
      Ничего не найдено
    </p>
  );

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
        <aside className="hidden md:flex w-60 border-r border-border bg-muted/20 p-4 flex-col gap-3 shrink-0">
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
          {searchBox}
          <nav className="flex flex-col gap-4 overflow-y-auto">
            {visibleGroups.length === 0 && emptyResults}
            {visibleGroups.map((g) => (
              <div key={g.label} className="flex flex-col gap-1">
                <div className="px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.label}
                </div>
                {g.items.map((tab) => (
                  <button
                    key={tab.id}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-xl text-sm transition",
                      activeTab === tab.id
                        ? "bg-muted text-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                    )}
                    onClick={() => setActiveTab(tab.id)}
                    aria-current={activeTab === tab.id ? "page" : undefined}
                    type="button"
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
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
          <nav className="flex-1 overflow-y-auto p-3 space-y-4">
            {searchBox}
            {visibleGroups.length === 0 && emptyResults}
            {visibleGroups.map((g) => (
              <div key={g.label} className="space-y-1">
                <div className="px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.label}
                </div>
                {g.items.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[15px] hover:bg-muted/60 active:bg-muted transition"
                    onClick={() => {
                      setActiveTab(tab.id);
                      setMobileView("content");
                    }}
                  >
                    <span className="flex-1 font-medium">{tab.label}</span>
                    <span className="text-muted-foreground">›</span>
                  </button>
                ))}
              </div>
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
            {activeTab === "appearance" && <AppearanceTabContent />}
            {activeTab === "models" && <ModelsTabContent />}
            {activeTab === "self-improve" && (
              <SelfImproveTabContent ops={ops} />
            )}
            {activeTab === "about" && <AboutTabContent />}
          </div>
        </div>
      </div>
    </div>
  );
}
