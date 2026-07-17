// SW_KILLSWITCH: чистим устаревший Service Worker и кеши один раз
// (после того как мы отключили VitePWA — старые клиенты держат stale bundle)
if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((regs) => {
      for (const r of regs) r.unregister().catch(() => {});
    })
    .catch(() => {});
  if ("caches" in window) {
    caches
      .keys()
      .then((keys) => keys.forEach((k) => caches.delete(k).catch(() => {})))
      .catch(() => {});
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
