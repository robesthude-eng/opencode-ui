/**
 * Per-user + IP shared rate limiting.
 *
 * Set RATE_LIMIT_REDIS_URL (or REDIS_URL) in every application instance to
 * enforce one limit across the fleet. In development without Redis, it uses a
 * process-local fallback so the application remains easy to run.
 */
import { getClientIp } from "./auth.mjs";
import { resetRateLimitStore, takeRateLimit } from "./rate-limit-store.mjs";

/**
 * @param {string} key
 * @param {{ limit: number, windowMs: number }} opts
 * @returns {Promise<{ allowed: boolean, remaining: number, retryAfterSec: number, unavailable?: boolean }>}
 */
export function take(key, opts) {
  return takeRateLimit(key, opts);
}

/**
 * HTTP rate-limit check. Writes 429 when the quota is exhausted, or 503 when
 * a configured Redis-backed shared limiter is unavailable (fail closed).
 */
export async function checkUserRateLimit(req, res, userKey, opts = {}) {
  const limit = opts.limit ?? 60;
  const windowMs = opts.windowMs ?? 60_000;
  const ip = getClientIp(req);
  const key = `u:${userKey || "anon"}|ip:${ip}|${opts.bucket || "default"}`;
  const result = await take(key, { limit, windowMs });
  if (result.unavailable) {
    res.writeHead(503, { "Content-Type": "application/json", "Retry-After": "1" });
    res.end(JSON.stringify({ error: "Rate-limit service unavailable. Retry shortly." }));
    return false;
  }
  if (!result.allowed) {
    res.writeHead(429, {
      "Content-Type": "application/json",
      "Retry-After": String(result.retryAfterSec),
    });
    res.end(JSON.stringify({ error: `Rate limit exceeded. Retry in ${result.retryAfterSec}s.` }));
    return false;
  }
  return true;
}

export function resetRateLimits() {
  resetRateLimitStore();
}
