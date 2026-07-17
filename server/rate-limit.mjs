/**
 * Per-user (and per-IP) token-bucket style rate limiting.
 */
import { getClientIp } from "./auth.mjs";

const buckets = new Map();

/**
 * @param {string} key
 * @param {{ limit: number, windowMs: number }} opts
 * @returns {{ allowed: boolean, remaining: number, retryAfterSec: number }}
 */
export function take(key, { limit, windowMs }) {
  const now = Date.now();
  let rec = buckets.get(key);
  if (!rec || now - rec.start >= windowMs) {
    rec = { count: 0, start: now };
    buckets.set(key, rec);
  }
  if (rec.count >= limit) {
    const retryAfterSec = Math.ceil((windowMs - (now - rec.start)) / 1000);
    return { allowed: false, remaining: 0, retryAfterSec };
  }
  rec.count += 1;
  // opportunistic cleanup
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (now - v.start >= windowMs) buckets.delete(k);
    }
  }
  return { allowed: true, remaining: limit - rec.count, retryAfterSec: 0 };
}

/**
 * Express-style check: writes 429 and returns false if limited.
 */
export function checkUserRateLimit(req, res, userKey, opts = {}) {
  const limit = opts.limit ?? 60;
  const windowMs = opts.windowMs ?? 60_000;
  const ip = getClientIp(req);
  const key = `u:${userKey || "anon"}|ip:${ip}|${opts.bucket || "default"}`;
  const result = take(key, { limit, windowMs });
  if (!result.allowed) {
    res.writeHead(429, {
      "Content-Type": "application/json",
      "Retry-After": String(result.retryAfterSec),
    });
    res.end(
      JSON.stringify({
        error: `Rate limit exceeded. Retry in ${result.retryAfterSec}s.`,
      }),
    );
    return false;
  }
  return true;
}

export function resetRateLimits() {
  buckets.clear();
}
