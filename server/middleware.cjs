/**
 * Security middleware: headers, body limits, rate limiting.
 */

// Body size limits
const MAX_BODY_BYTES = 50 * 1024 * 1024; // 50 MB for uploads
const MAX_JSON_BODY_BYTES = 256 * 1024;  // 256 KB for JSON endpoints

// Upload rate limiting (per-IP)
const uploadAttempts = new Map();
const UPLOAD_WINDOW_MS = 60 * 1000; // 1 minute
const UPLOAD_MAX_PER_WINDOW = 20;   // max 20 uploads per minute per IP

/**
 * Set security headers on response.
 */
function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  // CSP: relaxed for React SPA but without unsafe-eval
  // script-src has no 'unsafe-inline': the app loads a single bundled module
  // script (see index.html) and never injects inline <script> tags, so this
  // can be locked down without breaking anything. style-src keeps
  // 'unsafe-inline' since React components set inline style="" attributes.
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
}

/**
 * Read request body with size limit.
 */
function readBody(req, maxBytes = MAX_JSON_BODY_BYTES) {
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

/**
 * Upload rate limit check (per-IP, per-minute window).
 * Returns true if allowed, false if rate limited.
 */
function checkUploadRateLimit(req, res) {
  const ip = req.socket.remoteAddress || "unknown";
  const now = Date.now();
  let record = uploadAttempts.get(ip);
  if (!record || now - record.startTime > UPLOAD_WINDOW_MS) {
    record = { count: 0, startTime: now };
    uploadAttempts.set(ip, record);
  }
  if (record.count >= UPLOAD_MAX_PER_WINDOW) {
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Upload rate limit exceeded. Try again later." }));
    return false;
  }
  record.count++;
  // Cleanup old entries
  if (uploadAttempts.size > 500) {
    for (const [key, val] of uploadAttempts.entries()) {
      if (now - val.startTime > UPLOAD_WINDOW_MS) uploadAttempts.delete(key);
    }
  }
  return true;
}

/**
 * Rebuild rate limiter (for self-improvement endpoints).
 */
let lastRebuildTime = 0;
const REBUILD_COOLDOWN_MS = 10000;

function checkRateLimit(res) {
  const now = Date.now();
  if (now - lastRebuildTime < REBUILD_COOLDOWN_MS) {
    const waitSec = Math.ceil((REBUILD_COOLDOWN_MS - (now - lastRebuildTime)) / 1000);
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Too many requests. Please wait ${waitSec}s before rebuilding again.` }));
    return false;
  }
  lastRebuildTime = now;
  return true;
}

module.exports = {
  MAX_BODY_BYTES,
  MAX_JSON_BODY_BYTES,
  setSecurityHeaders,
  readBody,
  checkUploadRateLimit,
  checkRateLimit,
};
