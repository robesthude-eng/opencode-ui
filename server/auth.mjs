/**
 * Authentication module: password hashing, session management, rate limiting,
 * HttpOnly cookie sessions + CSRF origin checks.
 */
import crypto from "node:crypto";
import { loadJson, saveAuthJson } from "./db.mjs";

/** Cookie name for the session token (HttpOnly). */
export const SESSION_COOKIE = "opencode_session";

/**
 * Optional password pepper from env (OPENCODE_PASSWORD_PEPPER).
 * Applied as HMAC-SHA256 before scrypt so DB dumps alone are not enough.
 */
function pepperPassword(password) {
  const pepper = process.env.OPENCODE_PASSWORD_PEPPER || "";
  if (!pepper) return password;
  return crypto.createHmac("sha256", pepper).update(password).digest("hex");
}

/**
 * Hash a password with scrypt. Returns "salt:hash" string.
 * Format v2 with pepper uses prefix "v2:" — verify tries peppered then legacy.
 */
export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const material = pepperPassword(password);
  const hash = crypto.scryptSync(material, salt, 64).toString("hex");
  // v2 marker only when pepper is configured (new hashes)
  if (process.env.OPENCODE_PASSWORD_PEPPER) {
    return `v2:${salt}:${hash}`;
  }
  return `${salt}:${hash}`;
}

/**
 * Verify a password against a stored "salt:hash" or "v2:salt:hash" string.
 * Uses timing-safe comparison to prevent timing attacks.
 * Supports legacy unpeppered hashes for migration.
 */
export function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== "string" || !storedHash.includes(":")) return false;
  if (!password || typeof password !== "string" || password.length === 0) return false;

  const tryVerify = (material, salt, originalHash) => {
    try {
      const testHash = crypto.scryptSync(material, salt, 64).toString("hex");
      const originalBuf = Buffer.from(originalHash, "hex");
      const testBuf = Buffer.from(testHash, "hex");
      if (originalBuf.length !== testBuf.length) return false;
      return crypto.timingSafeEqual(originalBuf, testBuf);
    } catch {
      return false;
    }
  };

  try {
    if (storedHash.startsWith("v2:")) {
      const rest = storedHash.slice(3);
      const [salt, originalHash] = rest.split(":");
      if (!salt || !originalHash) return false;
      return tryVerify(pepperPassword(password), salt, originalHash);
    }
    const [salt, originalHash] = storedHash.split(":");
    if (!salt || !originalHash) return false;
    // Legacy: raw password. Also try peppered if pepper set (rehash path optional).
    if (tryVerify(password, salt, originalHash)) return true;
    if (process.env.OPENCODE_PASSWORD_PEPPER) {
      return tryVerify(pepperPassword(password), salt, originalHash);
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Parse the OPENCODE_ADMIN_EMAILS env var into a lowercase Set.
 * Emails listed here are always treated as admins, regardless of stored role
 * (useful for recovering admin access or for a fixed-operator deployment).
 */
function getConfiguredAdminEmails() {
  const raw = process.env.OPENCODE_ADMIN_EMAILS || "";
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Check whether a user is an administrator.
 * A user is admin if:
 *  - their email is listed in OPENCODE_ADMIN_EMAILS, or
 *  - their stored user record has role === "admin" (set for the very first
 *    account registered on a fresh instance — see index.mjs register handler).
 */
export function isAdmin(email, usersFile) {
  if (!email) return false;
  const cleanEmail = email.toLowerCase().trim();
  if (getConfiguredAdminEmails().has(cleanEmail)) return true;
  const users = loadJson(usersFile, {});
  const user = users[cleanEmail];
  return !!user && user.role === "admin";
}

/**
 * Parse Cookie header into a plain object.
 */
export function parseCookies(req) {
  const header = req.headers?.cookie || req.headers?.Cookie || "";
  if (!header || typeof header !== "string") return {};
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

/**
 * Extract raw session token from request.
 * Priority: HttpOnly cookie → X-Auth-Token / Authorization header → ?token= (SSE legacy).
 */
export function extractToken(req) {
  const cookies = parseCookies(req);
  if (cookies[SESSION_COOKIE]) return cookies[SESSION_COOKIE];

  let token = (req.headers?.["x-auth-token"] || req.headers?.authorization || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (token) return token;

  if (req.url?.includes("token=")) {
    try {
      token = new URL(req.url, "http://localhost").searchParams.get("token") || "";
    } catch {
      token = "";
    }
  }
  return token || "";
}

/**
 * Build Set-Cookie header value for the session token.
 */
export function buildSessionCookie(token, maxAgeMs) {
  const maxAge = Math.max(0, Math.floor((maxAgeMs || 7 * 24 * 60 * 60 * 1000) / 1000));
  const secure =
    process.env.COOKIE_SECURE === "1" ||
    process.env.NODE_ENV === "production" ||
    process.env.RAILWAY_ENVIRONMENT != null;
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Build Set-Cookie header that clears the session cookie.
 */
export function buildClearSessionCookie() {
  const secure =
    process.env.COOKIE_SECURE === "1" ||
    process.env.NODE_ENV === "production" ||
    process.env.RAILWAY_ENVIRONMENT != null;
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * CSRF defense-in-depth for cookie-authenticated mutating requests.
 * SameSite=Lax already blocks most cross-site POSTs; this rejects mismatched Origin/Referer.
 * Returns true if allowed, false if blocked (response already sent).
 */
export function checkCsrf(req, res) {
  const method = (req.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;

  // Only enforce when the request is cookie-authenticated (header/query tokens are not CSRF-able the same way)
  const cookies = parseCookies(req);
  if (!cookies[SESSION_COOKIE]) return true;

  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  const proto = (req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  if (!host) return true;

  const allowedOrigins = new Set([`${proto}://${host}`, `https://${host}`, `http://${host}`]);
  // Railway / reverse-proxy may present bare host without port; also allow localhost for dev
  if (process.env.NODE_ENV !== "production") {
    allowedOrigins.add("http://localhost:3000");
    allowedOrigins.add("http://localhost:5173");
    allowedOrigins.add("http://127.0.0.1:3000");
    allowedOrigins.add("http://127.0.0.1:5173");
  }

  const origin = req.headers.origin || "";
  const referer = req.headers.referer || req.headers.referrer || "";

  if (origin) {
    if (!allowedOrigins.has(origin)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "CSRF check failed (origin)" }));
      return false;
    }
    return true;
  }

  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      if (!allowedOrigins.has(refOrigin)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "CSRF check failed (referer)" }));
        return false;
      }
      return true;
    } catch {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "CSRF check failed (referer)" }));
      return false;
    }
  }

  // No Origin/Referer on a cookie-auth mutating request — reject (browsers always send one for form/fetch)
  res.writeHead(403, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "CSRF check failed (missing origin)" }));
  return false;
}

/**
 * Extract user email from request token.
 * Returns null if token is invalid or expired.
 */
export function getUserEmail(req, sessionsFile, sessionTtlMs) {
  const token = extractToken(req);
  if (!token) return null;
  const sessions = loadJson(sessionsFile, {});
  const s = sessions[token];
  if (!s?.email) return null;
  if (sessionTtlMs > 0 && Date.now() - (s.createdAt || 0) > sessionTtlMs) return null;
  return s.email;
}

/**
 * Check if request has valid auth token.
 * Returns true if authenticated, false if unauthorized (sends 401 response).
 */
export function checkAuth(req, res, usersFile, sessionsFile, sessionTtlMs) {
  const token = extractToken(req);
  const sessions = loadJson(sessionsFile, {});
  const sess = token ? sessions[token] : null;
  if (sess?.email) {
    if (sessionTtlMs > 0 && Date.now() - (sess.createdAt || 0) > sessionTtlMs) {
      delete sessions[token];
      saveAuthJson(sessionsFile, sessions);
    } else {
      return true; // Valid, non-expired session token
    }
  }

  const users = loadJson(usersFile, {});
  if (Object.keys(users).length > 0) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized", needLogin: true }));
    return false;
  }

  // No users registered yet: allow only static pages and auth endpoints
  if (req.url?.startsWith("/api/")) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized", needLogin: true }));
    return false;
  }
  return true;
}

// Rate limiting state
const authAttempts = new Map();
const AUTH_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const AUTH_MAX_ATTEMPTS = 10;

/**
 * Check auth rate limit. Returns true if allowed, false if rate limited.
 */
export function checkAuthRateLimit(req, res) {
  const ip = req.socket.remoteAddress || "unknown";
  const now = Date.now();
  let record = authAttempts.get(ip);
  if (!record || now - record.startTime > AUTH_WINDOW_MS) {
    record = { count: 0, startTime: now };
    authAttempts.set(ip, record);
  }
  if (record.count >= AUTH_MAX_ATTEMPTS) {
    const waitMin = Math.ceil((AUTH_WINDOW_MS - (now - record.startTime)) / 60000);
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: `Слишком много попыток входа. Пожалуйста, подождите ${waitMin} мин.`,
      }),
    );
    return false;
  }
  record.count++;
  // Cleanup old entries
  if (authAttempts.size > 1000) {
    for (const [key, val] of authAttempts.entries()) {
      if (now - val.startTime > AUTH_WINDOW_MS) authAttempts.delete(key);
    }
  }
  return true;
}

/**
 * Reset rate limit for a request (after successful auth).
 */
export function resetAuthRateLimit(req) {
  const ip = req.socket.remoteAddress || "unknown";
  authAttempts.delete(ip);
}
