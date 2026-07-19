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
      // 1% трейсов достаточно для картины производительности и не выжигает
      // месячный лимит Sentry.
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.01),
      maxBreadcrumbs: 30,
      // Обрезаем гигантские поля (история чата, стейт) перед отправкой:
      // сериализация огромного объекта сама способна уронить процесс.
      beforeSend: trimSentryEvent,
    });
    console.log("[Sentry] server initialized");
  } catch (e) {
    console.warn("[Sentry] init failed:", e.message);
    Sentry = null;
  }
}

const MAX_FIELD_CHARS = 4000;

function trimValue(value, depth = 0) {
  if (typeof value === "string") {
    return value.length > MAX_FIELD_CHARS
      ? `${value.slice(0, MAX_FIELD_CHARS)}…[trimmed ${value.length - MAX_FIELD_CHARS} chars]`
      : value;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 50)
      .map((v) => (depth < 4 ? trimValue(v, depth + 1) : "[trimmed]"));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 50)) {
      out[k] = depth < 4 ? trimValue(v, depth + 1) : "[trimmed]";
    }
    return out;
  }
  return value;
}

export function trimSentryEvent(event) {
  try {
    if (event?.extra) event.extra = trimValue(event.extra);
    if (event?.contexts) event.contexts = trimValue(event.contexts);
    if (event?.request?.data)
      event.request.data = trimValue(event.request.data);
    if (Array.isArray(event?.breadcrumbs))
      event.breadcrumbs = event.breadcrumbs.slice(-30);
  } catch {
    /* обрезка не должна ломать отправку события */
  }
  return event;
}

export function captureServerException(err) {
  try {
    Sentry?.captureException?.(err);
  } catch {
    /* ignore */
  }
}
