// SW_KILLSWITCH: чистим устаревший Service Worker и кеши один раз в фоне
// (после того как мы отключили VitePWA — старые клиенты держат stale bundle).
// Выполняется асинхронно после первого рендера, чтобы не задерживать initial paint.
if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  const runSwCleanup = () => {
    const swCleanup: Promise<boolean> = navigator.serviceWorker
      .getRegistrations()
      .then((regs) =>
        Promise.all(regs.map((r) => r.unregister().catch(() => false))),
      )
      .then((results) => results.some(Boolean))
      .catch(() => false);
    const cacheCleanup: Promise<boolean> =
      "caches" in window
        ? caches
            .keys()
            .then((keys) =>
              Promise.all(keys.map((k) => caches.delete(k).catch(() => false))),
            )
            .then((results) => results.some(Boolean))
            .catch(() => false)
        : Promise.resolve(false);
    // P1-fix (ChunkLoadError): текущая вкладка могла загрузиться из stale
    // SW-кэша — её lazy-чанки после очистки падают с ChunkLoadError.
    // После РЕАЛЬНОЙ очистки (что-то удалено) один раз перезагружаем
    // страницу; флаг в sessionStorage защищает от цикла перезагрузок.
    Promise.all([swCleanup, cacheCleanup]).then(
      ([swCleaned, cachesCleaned]) => {
        if (!swCleaned && !cachesCleaned) return;
        try {
          if (sessionStorage.getItem("sw_killswitch_reloaded") === "1") return;
          sessionStorage.setItem("sw_killswitch_reloaded", "1");
        } catch {
          return; // без защиты от цикла не рискуем перезагружать
        }
        window.location.reload();
      },
    );
  };

  if ("requestIdleCallback" in window) {
    (
      window as unknown as { requestIdleCallback: (cb: () => void) => void }
    ).requestIdleCallback(runSwCleanup);
  } else {
    setTimeout(runSwCleanup, 1500);
  }
}

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { initSentryBrowser } from "./lib/sentry";
import "./index.css";

initSentryBrowser();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
