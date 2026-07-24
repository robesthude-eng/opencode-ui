import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EventStream } from "./api/events";
import ChatView from "./components/ChatView";
import Composer from "./components/Composer";
import LoginPage from "./components/LoginPage";
import PermissionDialog from "./components/PermissionDialog";
import SettingsPanel from "./components/SettingsPanel";
import Sidebar from "./components/Sidebar";
import ToastHost from "./components/ToastHost";
import TopBar from "./components/TopBar";
import Workspace from "./components/Workspace";
import { applyTheme } from "./config/theme";
import { isTmpSession } from "./lib/ids";
import { useStore } from "./store/useStore";

function AuthGate({ children }: { children: React.ReactNode }) {
  const currentUser = useStore((s) => s.currentUser);
  const authChecking = useStore((s) => s.authChecking);
  const checkCurrentUser = useStore((s) => s.checkCurrentUser);

  useEffect(() => {
    checkCurrentUser();
  }, [checkCurrentUser]);

  if (authChecking) {
    return (
      <div className="flex h-dvh w-dvw items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">
          Загрузка OpenCode UI…
        </div>
      </div>
    );
  }
  if (!currentUser) return <LoginPage />;
  return <>{children}</>;
}

function AppShell() {
  const loadSessions = useStore((s) => s.loadSessions);
  const applyEvent = useStore((s) => s.applyEvent);
  const setConnection = useStore((s) => s.setConnection);
  const theme = useStore((s) => s.theme);
  const workspaceOpen = useStore((s) => s.workspaceOpen);
  const setWorkspaceOpen = useStore((s) => s.setWorkspaceOpen);
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const loadModels = useStore((s) => s.loadModels);
  const checkConnection = useStore((s) => s.checkConnection);
  const serverConnected = useStore((s) => s.serverConnected);
  const connection = useStore((s) => s.connection);
  const currentUser = useStore((s) => s.currentUser);
  const select = useStore((s) => s.select);
  const currentID = useStore((s) => s.currentID);
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { sessionId?: string };
  // Ref to break the URL ↔ store sync loop: when WE call navigate(), we set
  // this flag so the URL→store effect knows the URL change is from us and
  // shouldn't call select() (which would re-trigger the store→URL effect).
  const lastNavigateFromStore = useRef<string | null>(null);
  // Single SSE stream instance — kept in a ref so the session-switch effect
  // below can retarget it without tearing down the whole subscription.
  const streamRef = useRef<EventStream | null>(null);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // UX-fix: on app mount, pull authoritative self-improve state from server.
  // Prevents localStorage drift (server was reset, admin toggled from another tab, etc.)
  useEffect(() => {
    const sync = useStore.getState().syncSelfImproveFromServer;
    if (typeof sync === "function") {
      sync().catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    checkConnection();
    loadSessions();
    loadModels();
    // Subscribe the SSE stream to the ACTIVE session's directory-scoped event
    // bus (see eventUrl). Without this, per-session token events never reach
    // the client and streaming degrades to 3s polling batches.
    const initialSid = useStore.getState().currentID;
    const stream = new EventStream(
      undefined,
      initialSid && !isTmpSession(initialSid) ? initialSid : null,
    );
    streamRef.current = stream;
    const off = stream.on((e) => applyEvent(e));
    let poll: ReturnType<typeof setInterval> | null = setInterval(
      () => setConnection(stream.status),
      400,
    );
    let healthPoll: ReturnType<typeof setInterval> | null = setInterval(
      () => checkConnection(),
      15000,
    );
    let modelsPoll: ReturnType<typeof setInterval> | null = setInterval(
      () => loadModels(true),
      60000,
    );

    // Pause polling when tab is hidden (mobile background, browser tab switch).
    // Saves battery and prevents unnecessary network requests.
    const onVisibility = () => {
      if (document.hidden) {
        if (poll) {
          clearInterval(poll);
          poll = null;
        }
        if (healthPoll) {
          clearInterval(healthPoll);
          healthPoll = null;
        }
        if (modelsPoll) {
          clearInterval(modelsPoll);
          modelsPoll = null;
        }
      } else {
        if (!poll) poll = setInterval(() => setConnection(stream.status), 400);
        if (!healthPoll)
          healthPoll = setInterval(() => checkConnection(), 15000);
        if (!modelsPoll)
          modelsPoll = setInterval(() => loadModels(true), 60000);
        checkConnection(); // immediate check on resume
        // P1-fix: после возврата на вкладку SSE мог умереть (телефон спал,
        // ноутбук закрыт) — сбрасываем backoff и переподключаемся сразу.
        stream.wake();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    // P1-fix: сеть вернулась (Wi-Fi/VPN) — немедленный reconnect вместо
    // ожидания хвоста экспоненциального backoff (до 30s) или "give up".
    const onOnline = () => stream.wake();
    window.addEventListener("online", onOnline);

    return () => {
      off();
      stream.close();
      if (streamRef.current === stream) streamRef.current = null;
      if (poll) clearInterval(poll);
      if (healthPoll) clearInterval(healthPoll);
      if (modelsPoll) clearInterval(modelsPoll);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [
    currentUser,
    loadSessions,
    loadModels,
    applyEvent,
    setConnection,
    checkConnection,
  ]);

  // Real-time streaming: retarget the SSE stream at the active session so its
  // directory-scoped token events (message.part.updated / .delta) arrive live.
  useEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const sid = currentID && !isTmpSession(currentID) ? currentID : null;
    stream.switchSession(sid);
  }, [currentID]);

  // Sync URL → store (ignore optimistic temp IDs)
  // GUARD: if the URL changed because WE just called navigate() in the
  // store→URL effect (lastNavigateFromStore matches params.sessionId),
  // skip select() — the store is already the source of truth.
  // This breaks the infinite loop:
  //   select(NEW) → currentID=NEW → store→URL navigates to /chat/NEW
  //   → params.sessionId=NEW, but URL was OLD just before → URL→store
  //   would call select(OLD) → currentID=OLD → store→URL navigates to /chat/OLD
  //   → ... ∞
  useEffect(() => {
    if (
      params.sessionId &&
      params.sessionId !== currentID &&
      !isTmpSession(params.sessionId)
    ) {
      if (lastNavigateFromStore.current === params.sessionId) {
        // We initiated this navigation; currentID already matches our intent.
        // Don't call select() — that would loop back.
        return;
      }
      select(params.sessionId).catch(() => {});
    }
  }, [params.sessionId, currentID, select]);

  // Sync store → URL when chat selected without route param (skip temp IDs)
  useEffect(() => {
    if (
      currentID &&
      !isTmpSession(currentID) &&
      params.sessionId !== currentID
    ) {
      lastNavigateFromStore.current = currentID;
      navigate({
        to: "/chat/$sessionId",
        params: { sessionId: currentID },
        replace: true,
      });
    }
  }, [currentID, params.sessionId, navigate]);

  return (
    <div className="flex h-dvh w-dvw flex-col overflow-hidden bg-background text-foreground">
      <TopBar />
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Левый сайдбар: плавная анимация ширины на десктопе */}
        <div
          className={cn(
            "hidden md:block shrink-0 transition-all duration-300 ease-in-out overflow-hidden",
            sidebarCollapsed ? "w-0 opacity-0" : "w-[224px] opacity-100",
          )}
        >
          <div className="w-[224px] h-full">
            <Sidebar />
          </div>
        </div>
        {/* Мобильная версия сайдбара без анимации контейнера */}
        <div className="md:hidden">
          <Sidebar />
        </div>

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            {/* Chat + Composer — единый блок, который сдвигается при открытии Workspace */}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
              <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
                {serverConnected === false && (
                  <ConnectionBanner onRetry={checkConnection} />
                )}
                {serverConnected !== false && connection === "closed" && (
                  <SseReconnectBanner
                    onRetry={() => streamRef.current?.wake()}
                  />
                )}
                <Outlet />
              </main>

              <Composer />
            </div>

            {/* Мобильный overlay для Workspace */}
            {workspaceOpen && (
              <div
                className="absolute inset-0 z-40 bg-black/50 md:hidden"
                onClick={() => setWorkspaceOpen(false)}
              />
            )}

            {/* Правый сайдбар (Workspace): плавная анимация ширины */}
            <div
              className={cn(
                "absolute right-0 top-0 bottom-0 z-50 md:relative shrink-0 transition-all duration-300 ease-in-out overflow-hidden bg-background md:bg-transparent",
                workspaceOpen
                  ? "w-[85vw] max-w-[320px] md:w-80 opacity-100 border-l border-border md:border-none shadow-lg md:shadow-none"
                  : "w-0 opacity-0",
              )}
            >
              <div className="w-[85vw] max-w-[320px] md:w-80 h-full flex flex-col min-h-0">
                <Workspace />
              </div>
            </div>
          </div>
        </div>
      </div>
      <PermissionDialog />
      <SettingsPanel />
      <ToastHost />
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
        Нет соединения с сервером OpenCode. Запустите его командой{" "}
        <code className="rounded bg-background/40 px-1.5 py-0.5 font-mono text-xs">
          opencode serve
        </code>
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 text-amber-100 hover:bg-amber-500/15 hover:text-amber-50"
        onClick={onRetry}
      >
        Повторить
      </Button>
    </div>
  );
}

function SseReconnectBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-sky-500/30",
        "bg-sky-500/10 px-3 py-2 text-sm text-sky-200",
      )}
    >
      <span className="inline-flex items-center gap-2">
        <span className="h-2 w-2 animate-pulse rounded-full bg-sky-400" />
        Потеряно соединение с потоком событий — переподключение…
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 text-sky-100 hover:bg-sky-500/15 hover:text-sky-50"
        onClick={onRetry}
      >
        Переподключить
      </Button>
    </div>
  );
}

const rootRoute = createRootRoute({
  component: () => (
    <AuthGate>
      <AppShell />
    </AuthGate>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <ChatView />,
});

const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chat/$sessionId",
  component: () => <ChatView />,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});

const routeTree = rootRoute.addChildren([indexRoute, chatRoute, loginRoute]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
