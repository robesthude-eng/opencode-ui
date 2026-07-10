/**
 * Optional Sentry bootstrap.
 *
 * To enable for real:
 *   npm i @sentry/react
 *   VITE_SENTRY_DSN=https://...@....ingest.sentry.io/...
 * then replace this file with a real init that imports @sentry/react.
 *
 * This stub never imports @sentry/* so production builds stay dependency-free.
 */

export function initSentryBrowser() {
  // no-op stub
}

export function captureException(_err: unknown) {
  // no-op stub — ErrorBoundary still shows UI recovery actions
}
