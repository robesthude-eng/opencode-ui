/**
 * Server-side Sentry (optional).
 * Set SENTRY_DSN to enable. Never throws if missing/misconfigured.
 */
let Sentry = null;
let inited = false;

export async function initSentryServer() {
  if (inited) return;
  inited = true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    Sentry = await import("@sentry/node");
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || "production",
      tracesSampleRate: 0.1,
    });
    console.log("[Sentry] server initialized");
  } catch (e) {
    console.warn("[Sentry] init failed:", e.message);
    Sentry = null;
  }
}

export function captureServerException(err) {
  try {
    Sentry?.captureException?.(err);
  } catch {
    /* ignore */
  }
}
