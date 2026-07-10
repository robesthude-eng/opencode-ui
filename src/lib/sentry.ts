/**
 * Browser Sentry bootstrap.
 * Requires VITE_SENTRY_DSN. Package @sentry/react is a real dependency.
 */
import * as Sentry from "@sentry/react";

let inited = false;

export function initSentryBrowser() {
  if (inited) return;
  inited = true;

  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE || "production",
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}

export function captureException(err: unknown) {
  try {
    if (!import.meta.env.VITE_SENTRY_DSN) return;
    Sentry.captureException(err);
  } catch {
    // ignore
  }
}
