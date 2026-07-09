/**
 * Authentication module: password hashing, session management, rate limiting.
 */
import crypto from "crypto";
import { loadJson, saveAuthJson } from "./db.mjs";

/**
 * Hash a password with scrypt. Returns "salt:hash" string.
 */
export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

/**
 * Verify a password against a stored "salt:hash" string.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== "string" || !storedHash.includes(":")) return false;
  if (!password || typeof password !== "string" || password.length === 0) return false;
  const [salt, originalHash] = storedHash.split(":");
  if (!salt || !originalHash) return false;
  try {
    const testHash = crypto.scryptSync(password, salt, 64).toString("hex");
    const originalBuf = Buffer.from(originalHash, "hex");
    const testBuf = Buffer.from(testHash, "hex");
    if (originalBuf.length !== testBuf.length) return false;
    return crypto.timingSafeEqual(originalBuf, testBuf);
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
      .filter(Boolean)
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
 * Extract user email from request token.
 * Returns null if token is invalid or expired.
 */
export function getUserEmail(req, sessionsFile, sessionTtlMs) {
  let token = (req.headers["x-auth-token"] || req.headers["authorization"] || "").replace(/^Bearer\s+/i, "").trim();
  if (!token && req.url.includes("token=")) {
    try { token = new URL(req.url, "http://localhost").searchParams.get("token") || ""; } catch (e) {}
  }
  const sessions = loadJson(sessionsFile, {});
  const s = sessions[token];
  if (!s || !s.email) return null;
  if (sessionTtlMs > 0 && Date.now() - (s.createdAt || 0) > sessionTtlMs) return null;
  return s.email;
}

/**
 * Check if request has valid auth token.
 * Returns true if authenticated, false if unauthorized (sends 401 response).
 */
export function checkAuth(req, res, usersFile, sessionsFile, sessionTtlMs) {
  let token = (req.headers["x-auth-token"] || req.headers["authorization"] || "").replace(/^Bearer\s+/i, "").trim();
  if (!token && req.url.includes("token=")) {
    try { token = new URL(req.url, "http://localhost").searchParams.get("token") || ""; } catch (e) {}
  }
  const sessions = loadJson(sessionsFile, {});
  const sess = token ? sessions[token] : null;
  if (sess && sess.email) {
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
  if (req.url && req.url.startsWith("/api/")) {
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
    res.end(JSON.stringify({ error: `Слишком много попыток входа. Пожалуйста, подождите ${waitMin} мин.` }));
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
