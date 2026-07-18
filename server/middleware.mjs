/**
 * Security middleware: headers, body limits, rate limiting.
 */
import { getClientIp } from "./auth.mjs";
import { MAX_JSON_BODY_BYTES } from "./config.mjs";
import { takeRateLimit } from "./rate-limit-store.mjs";

export { MAX_JSON_BODY_BYTES };

// Body size limits
export const MAX_BODY_BYTES = 50 * 1024 * 1024; // 50 MB for uploads

// Shared upload rate limiting (per-IP).
const UPLOAD_WINDOW_MS = 60 * 1000;
const UPLOAD_MAX_PER_WINDOW = 20;

/**
 * Set security headers on response.
 */
export function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  const allowFraming = process.env.ALLOW_FRAMING !== "0";
  if (!allowFraming) {
    res.setHeader("X-Frame-Options", "DENY");
  }
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  // CSP for SPA:
  // - no unsafe-eval
  // - style-src keeps unsafe-inline for React inline styles / Tailwind runtime edges
  // - connect-src allows Sentry ingest when VITE_SENTRY_DSN / SENTRY_DSN configured
  // - worker-src for PWA service worker
  const frameAncestors = allowFraming
    ? "frame-ancestors *"
    : "frame-ancestors 'none'";
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' ws: wss: https:",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      frameAncestors,
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  );
}

/**
 * Read request body with size limit.
 */
export function readBody(req, maxBytes = MAX_JSON_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalLen = 0;
    req.on("data", (chunk) => {
      totalLen += chunk.length;
      if (totalLen > maxBytes) {
        req.destroy();
        reject(new Error("Body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Shared upload rate-limit check (Redis when configured). */
export async function checkUploadRateLimit(req, res) {
  const result = await takeRateLimit(`upload:ip:${getClientIp(req)}`, {
    limit: UPLOAD_MAX_PER_WINDOW,
    windowMs: UPLOAD_WINDOW_MS,
  });
  if (result.unavailable) {
    res.writeHead(503, {
      "Content-Type": "application/json",
      "Retry-After": "1",
    });
    res.end(
      JSON.stringify({
        error: "Rate-limit service unavailable. Retry shortly.",
      }),
    );
    return false;
  }
  if (!result.allowed) {
    res.writeHead(429, {
      "Content-Type": "application/json",
      "Retry-After": String(result.retryAfterSec),
    });
    res.end(
      JSON.stringify({ error: "Upload rate limit exceeded. Try again later." }),
    );
    return false;
  }
  return true;
}

/** Shared rebuild cooldown, global across all instances. */
const REBUILD_COOLDOWN_MS = 10000;
export async function checkRateLimit(res) {
  const result = await takeRateLimit("self-improve:rebuild", {
    limit: 1,
    windowMs: REBUILD_COOLDOWN_MS,
  });
  if (result.unavailable) {
    res.writeHead(503, {
      "Content-Type": "application/json",
      "Retry-After": "1",
    });
    res.end(
      JSON.stringify({
        error: "Rate-limit service unavailable. Retry shortly.",
      }),
    );
    return false;
  }
  if (!result.allowed) {
    res.writeHead(429, {
      "Content-Type": "application/json",
      "Retry-After": String(result.retryAfterSec),
    });
    res.end(
      JSON.stringify({
        error: `Too many requests. Please wait ${result.retryAfterSec}s before rebuilding again.`,
      }),
    );
    return false;
  }
  return true;
}
