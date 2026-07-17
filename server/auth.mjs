/**
 * Authentication module: password hashing, session management, rate limiting,
 * HttpOnly cookie sessions + CSRF origin checks.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AUTH_USER, USER_KEYS_DIR } from "./config.mjs";
import { loadJson, saveAuthJson } from "./db.mjs";

let AUTH_PASSWORD = process.env.OPENCODE_SERVER_PASSWORD || process.env.OPENCODE_UI_PASSWORD || "";

export function initAuthPassword(workdir) {
  const passFile = path.join(workdir, ".admin_password");
  if (!AUTH_PASSWORD) {
    if (fs.existsSync(passFile)) {
      try {
        AUTH_PASSWORD = fs.readFileSync(passFile, "utf8").trim();
      } catch (e) {
        console.warn("Ignored error:", e.message);
      }
    }
    if (!AUTH_PASSWORD) {
      AUTH_PASSWORD = crypto.randomBytes(16).toString("hex");
      try {
        fs.mkdirSync(workdir, { recursive: true });
        fs.writeFileSync(passFile, AUTH_PASSWORD, { mode: 0o600 });
      } catch (e) {
        console.error(e.message);
      }
    }
  }
  return AUTH_PASSWORD;
}

export function checkBasicAuth(req, authPassword) {
  if (!authPassword) return false;
  const header = req.headers.authorization || "";
  const expected = `Basic ${Buffer.from(`${AUTH_USER}:${authPassword}`).toString("base64")}`;
  const hb = Buffer.from(header), eb = Buffer.from(expected);
  if (hb.length !== eb.length) return false;
  return crypto.timingSafeEqual(hb, eb);
}

export const SESSION_COOKIE = "opencode_session";

function getUserKeysFile(email) {
  return path.join(USER_KEYS_DIR, `${email.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`);
}

export function loadUserKeys(email) {
  const f = getUserKeysFile(email);
  if (fs.existsSync(f)) {
    try {
      return JSON.parse(fs.readFileSync(f, "utf8"));
    } catch (e) {
      console.warn("Ignored error:", e.message);
    }
  }
  return {};
}

export function saveUserKeys(email, keys) {
  const f = getUserKeysFile(email);
  fs.mkdirSync(USER_KEYS_DIR, { recursive: true });
  fs.writeFileSync(f, JSON.stringify(keys, null, 2), { mode: 0o600 });
}

/**
 * Password mode is active only for a fresh deployment that explicitly has a
 * shared Basic Auth password and no registered users yet. Once users exist,
 * the app switches to its regular session-based multi-user mode.
 */
export function isPasswordMode(authPassword, userCount) {
  return typeof authPassword === "string" && authPassword.length > 0 && userCount === 0;
}

function pepperPassword(password) {
  const pepper = process.env.OPENCODE_PASSWORD_PEPPER || "";
  if (!pepper) return password;
  return crypto.createHmac("sha256", pepper).update(password).digest("hex");
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const material = pepperPassword(password);
  const hash = crypto.scryptSync(material, salt, 64).toString("hex");
  if (process.env.OPENCODE_PASSWORD_PEPPER) {
    return `v2:${salt}:${hash}`;
  }
  return `${salt}:${hash}`;
}

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
    if (tryVerify(password, salt, originalHash)) return true;
    if (process.env.OPENCODE_PASSWORD_PEPPER) {
      return tryVerify(pepperPassword(password), salt, originalHash);
    }
    return false;
  } catch {
    return false;
  }
}

function getConfiguredAdminEmails() {
  const raw = process.env.OPENCODE_ADMIN_EMAILS || "";
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdmin(email, usersFile) {
  if (!email) return false;
  const cleanEmail = email.toLowerCase().trim();
  if (getConfiguredAdminEmails().has(cleanEmail)) return true;
  const users = loadJson(usersFile, {});
  const user = users[cleanEmail];
  return !!user && user.role === "admin";
}

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
 * Read a session token from credentials that do not expose it in URLs.
 * Query-string tokens are permitted only for the legacy WebSocket event
 * upgrade path, where the caller explicitly opts in.
 */
export function extractToken(req, { allowQueryToken = false } = {}) {
  const cookies = parseCookies(req);
  if (cookies[SESSION_COOKIE]) return cookies[SESSION_COOKIE];
  const token = (req.headers?.["x-auth-token"] || req.headers?.authorization || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (token || !allowQueryToken) return token;
  try {
    return new URL(req.url || "/", "http://localhost").searchParams.get("token") || "";
  } catch {
    return "";
  }
}

export function getClientIp(req) {
  const xff = req.headers?.["x-forwarded-for"];
  if (xff && typeof xff === "string") {
    return xff.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

export function buildSessionCookie(token, maxAgeMs, req) {
  const maxAge = Math.max(0, Math.floor((maxAgeMs || 7 * 24 * 60 * 60 * 1000) / 1000));
  const forwardedProto = String(req?.headers?.["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const isHttps = forwardedProto === "https" || Boolean(req?.socket?.encrypted);
  const forcedSecure = process.env.COOKIE_SECURE;
  // Do not mark a cookie Secure for a plain HTTP deployment: browsers then
  // silently drop it, causing every subsequent API request to return 401.
  // HTTPS remains the default when the request actually arrived over HTTPS;
  // COOKIE_SECURE=1 can force it for a trusted TLS proxy.
  const secure = forcedSecure === "1" || (forcedSecure !== "0" && isHttps);
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

export function buildClearSessionCookie() {
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  return parts.join("; ");
}

export function checkCsrf(req, res) {
  const method = (req.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  const cookies = parseCookies(req);
  if (!cookies[SESSION_COOKIE]) return true;
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  if (!host) return true;
  const proto = (req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  const allowedOrigins = new Set([`${proto}://${host}`, `https://${host}`, `http://${host}`]);
  if (process.env.NODE_ENV !== "production") {
    allowedOrigins.add("http://localhost:3000");
    allowedOrigins.add("http://localhost:5173");
    allowedOrigins.add("http://127.0.0.1:3000");
    allowedOrigins.add("http://127.0.0.1:5173");
  }
  const origin = req.headers.origin || "";
  if (origin) {
    if (!allowedOrigins.has(origin)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "CSRF check failed (origin)" }));
      return false;
    }
    return true;
  }
  const referer = req.headers.referer || req.headers.referrer || "";
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
  res.writeHead(403, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "CSRF check failed (missing origin)" }));
  return false;
}

export function getUserEmail(req, sessionsFile, sessionTtlMs) {
  const token = extractToken(req);
  if (!token) return null;
  const sessions = loadJson(sessionsFile, {});
  const s = sessions[token];
  if (!s?.email) return null;
  if (sessionTtlMs > 0 && Date.now() - (s.createdAt || 0) > sessionTtlMs) return null;
  return s.email;
}

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
  if (req.url?.startsWith("/api/")) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized", needLogin: true }));
    return false;
  }
  return true;
}

export function checkAuthRateLimit(req, res) {
  const ip = getClientIp(req);
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
  if (authAttempts.size > 100) {
    for (const [key, val] of authAttempts.entries()) {
      if (now - val.startTime > AUTH_WINDOW_MS) authAttempts.delete(key);
    }
  }
  return true;
}

export function resetAuthRateLimit(req) {
  const ip = getClientIp(req);
  authAttempts.delete(ip);
}

const authAttempts = new Map();
const AUTH_WINDOW_MS = 5 * 60 * 1000;
const AUTH_MAX_ATTEMPTS = 10;
