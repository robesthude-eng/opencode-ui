/**
 * Production server: serves the built React frontend AND proxies /api/* to OpenCode system instance.
 * 
 * ARCHITECTURE (post-fix, cleaned):
 * - Single OpenCode system instance on :4096 handles all sessions
 * - Per-session workspace isolation via ?directory=/app/workspace/sessions/{id}/workspace
 * - Single global event bus (/api/event) emits all session events (message.part.updated, session.status, etc.)
 * - No per-session process pool (ocPool) — it was causing SSE to break (separate buses, HTML fallback for /api/session/{id}/event)
 * - Frontend polls listMessages every 500ms as fallback for smooth streaming, plus global SSE
 */

const http = require("http");
const httpProxy = require("http-proxy");
const fs = require("fs");
const path = require("path");

// Import modules
const { loadJson, saveJson, saveAuthJson } = require("./db.cjs");
const { hashPassword, verifyPassword, getUserEmail, checkAuth, checkAuthRateLimit, resetAuthRateLimit, isAdmin } = require("./auth.cjs");
const { setSecurityHeaders, readBody, checkRateLimit, MAX_BODY_BYTES, MAX_JSON_BODY_BYTES, checkUploadRateLimit } = require("./middleware.cjs");
const { parseMultipart } = require("./upload.cjs");
const { getUiDir, isSelfImproveEnabled, toggleSelfImprove, rebuildUi, resetUi, createCheckpoint, listCheckpoints, rollbackToCommit } = require("./self-improve.cjs");

// Config
const SYSTEM_PORT = parseInt(process.env.OC_SYSTEM_PORT || "4096", 10);
const PORT = process.env.PORT || 3000;
const DIST = path.join(__dirname, "..", "dist");
const WORKDIR = process.env.OPENCODE_WORKDIR || "/app/workspace";
const crypto = require("crypto");

// Files
const USERS_FILE = path.join(WORKDIR, ".users.json");
const SESSIONS_FILE = path.join(WORKDIR, ".sessions.json");
const SESSION_TTL_MS = parseInt(process.env.OPENCODE_SESSION_TTL_MS || "", 10) || (7 * 24 * 60 * 60 * 1000);
const OWNERS_FILE = path.join(WORKDIR, ".session_owners.json");
const USER_KEYS_DIR = path.join(WORKDIR, ".user_keys");

// Local helper — validates real session IDs (ses_...) and rejects temp optimistic IDs (tmp_...)
function isValidSessionId(sessionId) {
  if (typeof sessionId !== "string") return false;
  if (sessionId.startsWith("tmp_")) return false; // temp optimistic IDs are not real sessions
  return /^[a-zA-Z0-9_-]{1,128}$/.test(sessionId);
}

// Admin password
let AUTH_PASSWORD = process.env.OPENCODE_SERVER_PASSWORD || process.env.OPENCODE_UI_PASSWORD || "";
const AUTH_USER = process.env.OPENCODE_SERVER_USER || "opencode";
const passFile = path.join(WORKDIR, ".admin_password");

if (!AUTH_PASSWORD) {
  if (fs.existsSync(passFile)) {
    try { AUTH_PASSWORD = fs.readFileSync(passFile, "utf8").trim(); } catch (e) {}
  }
  if (!AUTH_PASSWORD) {
    AUTH_PASSWORD = crypto.randomBytes(16).toString("hex");
    try {
      fs.mkdirSync(WORKDIR, { recursive: true });
      fs.writeFileSync(passFile, AUTH_PASSWORD, { mode: 0o600 });
      console.log(`\n🔒 [SECURITY] Generated admin password: ${passFile}\n`);
    } catch (e) {
      console.error("[SECURITY] Failed to save password:", e.message);
    }
  }
}

// Per-user keys
function getUserKeysFile(userEmail) {
  const safeName = userEmail.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(USER_KEYS_DIR, `${safeName}.json`);
}
function loadUserKeys(userEmail) {
  const file = getUserKeysFile(userEmail);
  if (fs.existsSync(file)) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  }
  return {};
}
function saveUserKeys(userEmail, keys) {
  const file = getUserKeysFile(userEmail);
  fs.mkdirSync(USER_KEYS_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(keys, null, 2), { mode: 0o600 });
}

// Basic Auth check (single-operator "password mode" — no self-registered users yet).
// Timing-safe comparison to avoid leaking the password length/content via timing.
function checkBasicAuth(req) {
  if (!AUTH_PASSWORD) return false;
  const header = req.headers["authorization"] || "";
  const expected = "Basic " + Buffer.from(`${AUTH_USER}:${AUTH_PASSWORD}`).toString("base64");
  const headerBuf = Buffer.from(header);
  const expectedBuf = Buffer.from(expected);
  if (headerBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(headerBuf, expectedBuf);
}

// MIME
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

// Proxy
function createProxy(target) {
  const p = httpProxy.createProxyServer({
    target,
    changeOrigin: true,
    ws: true,
    selfHandleResponse: false,
  });
  p.on("proxyRes", (proxyRes, req, res) => {
    const ct = proxyRes.headers["content-type"] || "";
    if (ct.includes("text/event-stream")) {
      res.setHeader("X-Accel-Buffering", "no");
      res.setHeader("Cache-Control", "no-cache, no-transform");
    }
  });
  p.on("error", (err, req, res) => {
    if (res && !res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "OpenCode server not reachable", detail: err.message }));
    } else if (res) {
      res.end();
    }
  });
  return p;
}

const systemProxy = createProxy(`http://127.0.0.1:${SYSTEM_PORT}`);

// Extract sessionId
function extractSessionId(req) {
  const urlPath = req.url.split("?")[0];
  const pathMatch = urlPath.match(/^\/api\/session\/([^/?]+)/);
  if (pathMatch) {
    const sid = decodeURIComponent(pathMatch[1]);
    if (isValidSessionId(sid)) return sid;
  }
  try {
    const qs = new URL(req.url, "http://localhost").searchParams.get("sessionId");
    if (qs && isValidSessionId(qs)) return qs;
  } catch {}
  const hdr = req.headers["x-session-id"];
  if (hdr && isValidSessionId(hdr)) return hdr;
  return null;
}

// Ownership check
function checkSessionOwnership(sessionId, userEmail, res) {
  const owners = loadJson(OWNERS_FILE, {});
  if (owners[sessionId] && userEmail && owners[sessionId] !== userEmail) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Access denied: session belongs to another user." }));
    return false;
  }
  return true;
}

// Global routes (always system)
const GLOBAL_ROUTES = [
  "/api/config/providers",
  "/api/provider",
  "/api/auth/",
  "/api/global/",
];
function isGlobalRoute(urlPath) {
  return GLOBAL_ROUTES.some((r) => urlPath.startsWith(r));
}

// Session listing
function handleSessionList(req, res, userEmail) {
  http.get(`http://127.0.0.1:${SYSTEM_PORT}/session`, (ocRes) => {
    let body = "";
    ocRes.on("data", (c) => (body += c));
    ocRes.on("end", () => {
      try {
        const sessions = JSON.parse(body || "[]");
        const owners = loadJson(OWNERS_FILE, {});
        const filtered = userEmail ? sessions.filter((s) => owners[s.id] === userEmail) : sessions;
        res.writeHead(ocRes.statusCode, { "Content-Type": "application/json" });
        res.end(JSON.stringify(filtered));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to parse sessions" }));
      }
    });
  }).on("error", () => {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "OpenCode unreachable" }));
  });
}

// Static
function serveStatic(req, res) {
  let urlPath = req.url.split("?")[0];
  if (urlPath === "/") urlPath = "/index.html";
  let filePath = path.join(DIST, urlPath);
  if (!filePath.startsWith(DIST + path.sep) && filePath !== DIST) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST, "index.html");
  }
  const ext = path.extname(filePath);
  const contentType = MIME[ext] || "application/octet-stream";
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500);
      res.end("Internal error");
      return;
    }
    const headers = { "Content-Type": contentType };
    if (urlPath === "/index.html") {
      headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
    } else if (ext === ".js" || ext === ".css" || ext.match(/\.(png|jpg|svg|woff2?|ico)/)) {
      headers["Cache-Control"] = "public, max-age=31536000, immutable";
    }
    setSecurityHeaders(res);
    res.writeHead(200, headers);
    res.end(data);
  });
}

// HTTP Server
const server = http.createServer((req, res) => {
  setSecurityHeaders(res);

  if (req.url === "/health" || req.url === "/global/health" || req.url === "/api/global/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
    return;
  }

  const urlPath = req.url.split("?")[0];

  // Single-operator "password mode": if OPENCODE_SERVER_PASSWORD/OPENCODE_UI_PASSWORD
  // is set and nobody has self-registered an account yet, the whole app (UI + API)
  // is gated behind HTTP Basic Auth, as documented in the README. This previously
  // only guarded the WebSocket upgrade path — plain HTTP requests were never
  // actually checked against AUTH_PASSWORD, so the "password required" guarantee
  // did not hold for the REST API. Multi-user (email/password) mode, once any
  // account exists, keeps using session tokens instead (see checkAuth below).
  const noUsersYet = Object.keys(loadJson(USERS_FILE, {})).length === 0;
  const isAuthEndpoint =
    urlPath === "/auth/register" || urlPath === "/api/auth/register" ||
    urlPath === "/auth/login" || urlPath === "/api/auth/login";
  if (AUTH_PASSWORD && noUsersYet && !isAuthEndpoint && urlPath !== "/health" && urlPath !== "/global/health" && urlPath !== "/api/global/health") {
    if (!checkBasicAuth(req)) {
      res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": `Basic realm="OpenCode UI"` });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
  }

  // Auth endpoints (no auth required)
  if (urlPath === "/auth/register" || urlPath === "/api/auth/register") {
    if (req.method !== "POST") { res.writeHead(405); res.end(); return; }
    if (!checkAuthRateLimit(req, res)) return;
    readBody(req, 16384).then((buf) => {
      try {
        const { email, password } = JSON.parse(buf.toString("utf8") || "{}");
        if (!email || !email.includes("@") || !password || password.length < 6) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Enter a valid email and password (min 6 characters)." }));
          return;
        }
        const users = loadJson(USERS_FILE, {});
        const cleanEmail = email.toLowerCase().trim();
        if (users[cleanEmail]) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "User with this email already exists." }));
          return;
        }
        // The very first account registered on a fresh instance becomes admin.
        // Admin is required to enable Self-Improvement Mode and trigger rebuilds/
        // rollbacks, since those operations mutate the shared UI source for
        // every user of this deployment (see server/self-improve.cjs).
        const role = Object.keys(users).length === 0 ? "admin" : "user";
        users[cleanEmail] = { email: cleanEmail, passwordHash: hashPassword(password), createdAt: Date.now(), role };
        saveAuthJson(USERS_FILE, users);
        const token = crypto.randomBytes(32).toString("hex");
        const sessions = loadJson(SESSIONS_FILE, {});
        sessions[token] = { email: cleanEmail, createdAt: Date.now() };
        saveAuthJson(SESSIONS_FILE, sessions);
        resetAuthRateLimit(req);
        console.log(`[Auth] New user registered: ${cleanEmail} (role: ${role})`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "success", token, user: { email: cleanEmail, role } }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Registration failed" }));
      }
    }).catch(() => {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Request body too large" }));
    });
    return;
  }

  if (urlPath === "/auth/login" || urlPath === "/api/auth/login") {
    if (req.method !== "POST") { res.writeHead(405); res.end(); return; }
    if (!checkAuthRateLimit(req, res)) return;
    readBody(req, 16384).then((buf) => {
      try {
        const { email, password } = JSON.parse(buf.toString("utf8") || "{}");
        const users = loadJson(USERS_FILE, {});
        const cleanEmail = (email || "").toLowerCase().trim();
        const user = users[cleanEmail];
        if (!user || !verifyPassword(password || "", user.passwordHash)) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid email or password." }));
          return;
        }
        const token = crypto.randomBytes(32).toString("hex");
        const sessions = loadJson(SESSIONS_FILE, {});
        sessions[token] = { email: cleanEmail, createdAt: Date.now() };
        saveAuthJson(SESSIONS_FILE, sessions);
        resetAuthRateLimit(req);
        console.log(`[Auth] User logged in: ${cleanEmail}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "success", token, user: { email: cleanEmail, role: isAdmin(cleanEmail, USERS_FILE) ? "admin" : (user.role || "user") } }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Login failed" }));
      }
    }).catch(() => {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Request body too large" }));
    });
    return;
  }

  if (urlPath === "/auth/me" || urlPath === "/api/auth/me") {
    const email = getUserEmail(req, SESSIONS_FILE, SESSION_TTL_MS);
    if (!email) {
      const users = loadJson(USERS_FILE, {});
      if (Object.keys(users).length === 0) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "success", user: null, noUsers: true }));
        return;
      }
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "success", user: { email, role: isAdmin(email, USERS_FILE) ? "admin" : "user" } }));
    return;
  }

  if (urlPath === "/auth/logout" || urlPath === "/api/auth/logout") {
    let token = (req.headers["x-auth-token"] || req.headers["authorization"] || "").replace(/^Bearer\s+/i, "").trim();
    const sessions = loadJson(SESSIONS_FILE, {});
    delete sessions[token];
    saveAuthJson(SESSIONS_FILE, sessions);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "success" }));
    return;
  }

  if (!req.url.startsWith("/api/") && req.url !== "/api") {
    serveStatic(req, res);
    return;
  }

  // In single-operator password mode (no self-registered users), the request
  // already passed the Basic Auth gate above, so it's implicitly the sole
  // administrator — skip the session-token check that would otherwise force
  // the "no users yet" registration wall.
  const passwordModeAdmin = AUTH_PASSWORD && noUsersYet;
  if (!passwordModeAdmin) {
    if (!checkAuth(req, res, USERS_FILE, SESSIONS_FILE, SESSION_TTL_MS)) return;
  }
  const userEmail = getUserEmail(req, SESSIONS_FILE, SESSION_TTL_MS);
  const isRequestAdmin = passwordModeAdmin || isAdmin(userEmail, USERS_FILE);

  if (urlPath === "/api/auth/custom" && req.method === "GET") {
    if (!userEmail) { res.writeHead(401, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Unauthorized" })); return; }
    const keys = loadUserKeys(userEmail);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(Object.keys(keys)));
    return;
  }
  if (urlPath === "/api/auth/custom" && req.method === "POST") {
    if (!userEmail) { res.writeHead(401, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Unauthorized" })); return; }
    readBody(req, MAX_JSON_BODY_BYTES).then((buf) => {
      try {
        const { providerId, key } = JSON.parse(buf.toString("utf8") || "{}");
        if (!providerId || !key || !/^[a-zA-Z0-9_-]+$/.test(providerId)) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Invalid provider ID or key" })); return; }
        const keys = loadUserKeys(userEmail);
        keys[providerId] = { type: "api", key: key };
        saveUserKeys(userEmail, keys);
        console.log(`[Auth] Saved key for provider ${providerId} (user: ${userEmail})`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "success" }));
      } catch (e) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Invalid JSON" })); }
    }).catch(() => { res.writeHead(413, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Request body too large" })); });
    return;
  }
  if (urlPath === "/api/auth/custom" && req.method === "DELETE") {
    if (!userEmail) { res.writeHead(401, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Unauthorized" })); return; }
    readBody(req, MAX_JSON_BODY_BYTES).then((buf) => {
      try {
        const { providerId } = JSON.parse(buf.toString("utf8") || "{}");
        if (!providerId || !/^[a-zA-Z0-9_-]+$/.test(providerId)) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Invalid provider ID" })); return; }
        const keys = loadUserKeys(userEmail);
        delete keys[providerId];
        saveUserKeys(userEmail, keys);
        console.log(`[Auth] Removed key for provider ${providerId} (user: ${userEmail})`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "success" }));
      } catch (e) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Invalid JSON" })); }
    }).catch(() => { res.writeHead(413, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Request body too large" })); });
    return;
  }

  // Self-improvement endpoints — ADMIN ONLY.
  // These mutate the UI source code shared by every user of this deployment
  // (toggle write permissions, rebuild, reset to factory, git checkpoint/rollback),
  // so a plain authenticated user must not be able to reach them. Only the
  // account with role "admin" (the first one registered, or an email listed in
  // OPENCODE_ADMIN_EMAILS), or the single operator in password-only mode, may.
  const SELF_IMPROVE_ROUTES = new Set([
    "/api/settings/self-improve",
    "/api/rebuild",
    "/api/reset-ui",
    "/api/git/checkpoint",
    "/api/git/checkpoints",
    "/api/git/rollback",
  ]);
  if (SELF_IMPROVE_ROUTES.has(urlPath) && !isRequestAdmin) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Admin access required for self-improvement features." }));
    return;
  }

  if (req.url === "/api/settings/self-improve" && req.method === "POST") {
    readBody(req, MAX_JSON_BODY_BYTES).then((buf) => {
      try {
        const { enabled } = JSON.parse(buf.toString("utf8") || "{}");
        toggleSelfImprove(WORKDIR, enabled);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "success", enabled: !!enabled }));
      } catch (e) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Invalid JSON" })); }
    }).catch(() => { res.writeHead(413, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Request body too large" })); });
    return;
  }
  if (req.url === "/api/rebuild" && req.method === "POST") {
    if (!isSelfImproveEnabled(WORKDIR)) { res.writeHead(403, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Self-Improvement Mode is disabled on the server." })); return; }
    if (!checkRateLimit(res)) return;
    rebuildUi(WORKDIR, (err, stdout) => {
      if (err) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Rebuild failed", detail: err.message })); }
      else { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ status: "success", stdout })); }
    });
    return;
  }
  if (req.url === "/api/reset-ui" && req.method === "POST") {
    if (!isSelfImproveEnabled(WORKDIR)) { res.writeHead(403, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Self-Improvement Mode is disabled on the server." })); return; }
    if (!checkRateLimit(res)) return;
    resetUi(WORKDIR, (err, stdout) => {
      if (err) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Reset failed", detail: err.message })); }
      else { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ status: "success", stdout })); }
    });
    return;
  }
  if (req.url === "/api/git/checkpoint" && req.method === "POST") {
    if (!isSelfImproveEnabled(WORKDIR)) { res.writeHead(403, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Self-Improvement Mode is disabled on the server." })); return; }
    createCheckpoint(WORKDIR, (err, result) => {
      if (err) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Failed to create checkpoint", detail: err.message })); }
      else { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(result)); }
    });
    return;
  }
  if (req.url === "/api/git/checkpoints" && req.method === "GET") {
    listCheckpoints(WORKDIR, (err, commits) => {
      if (err) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Failed to list checkpoints" })); }
      else { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(commits)); }
    });
    return;
  }
  if (req.url === "/api/git/rollback" && req.method === "POST") {
    if (!isSelfImproveEnabled(WORKDIR)) { res.writeHead(403, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Self-Improvement Mode is disabled on the server." })); return; }
    if (!checkRateLimit(res)) return;
    readBody(req, MAX_JSON_BODY_BYTES).then((buf) => {
      try {
        const { hash } = JSON.parse(buf.toString("utf8") || "{}");
        if (!hash || !/^[a-fA-F0-9]{4,40}$/.test(hash)) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Invalid commit hash format." })); return; }
        rollbackToCommit(WORKDIR, hash, (err, result) => {
          if (err) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Rollback failed", detail: err.message })); }
          else { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ status: "success", message: result.message })); }
        });
      } catch (e) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Invalid JSON" })); }
    }).catch(() => { res.writeHead(413, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Request body too large" })); });
    return;
  }

  // Upload endpoints
  if (urlPath === "/api/workspace/upload-folder" && req.method === "POST") {
    if (!checkUploadRateLimit(req, res)) return;
    readBody(req, MAX_BODY_BYTES).then((buffer) => {
      const contentType = req.headers["content-type"] || "";
      const boundaryMatch = contentType.match(/boundary=(?:\"([^\"]+)\"|([^;]+))/);
      if (!boundaryMatch) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing multipart boundary" })); return; }
      let targetDir = WORKDIR;
      const sessionId = extractSessionId(req);
      if (sessionId) { targetDir = path.join(WORKDIR, "sessions", sessionId, "workspace"); }
      const boundary = boundaryMatch[1] || boundaryMatch[2];
      const parts = parseMultipart(buffer, boundary);
      const errors = []; const written = [];
      for (const part of parts) {
        const relPath = part.name.replace(/\\/g, "/").replace(/^\/+/, "");
        if (relPath.includes("..") || relPath.startsWith("/")) { errors.push("Rejected unsafe path: " + relPath); continue; }
        try { const fullPath = path.join(targetDir, relPath); fs.mkdirSync(path.dirname(fullPath), { recursive: true }); fs.writeFileSync(fullPath, part.data); written.push(relPath); } catch (e) { errors.push(relPath + ": " + e.message); }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: errors.length === 0, written: written.length, errors: errors.length > 0 ? errors : undefined }));
    }).catch(() => { res.writeHead(413, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "File too large (max 50 MB)" })); });
    return;
  }
  if (urlPath === "/api/workspace/upload" && req.method === "POST") {
    if (!checkUploadRateLimit(req, res)) return;
    let sessionId = "";
    try { sessionId = new URL(req.url, "http://localhost").searchParams.get("sessionId") || ""; } catch (e) {}
    if (sessionId && !/^[a-zA-Z0-9_-]+$/.test(sessionId)) sessionId = "";
    readBody(req, MAX_BODY_BYTES).then((buffer) => {
      const contentType = req.headers["content-type"] || "";
      const boundaryMatch = contentType.match(/boundary=(?:\"([^\"]+)\"|([^;]+))/);
      if (!boundaryMatch) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing multipart boundary" })); return; }
      const boundary = boundaryMatch[1] || boundaryMatch[2];
      const parts = parseMultipart(buffer, boundary);
      if (parts.length === 0) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "No file received" })); return; }
      const part = parts[0];
      const rawName = part.filename || part.name;
      const safeName = rawName.replace(/[\\/]/g, "_").replace(/^_+/, "");
      if (!safeName || safeName.includes("..")) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Invalid filename" })); return; }
      let uploadDir; let relativePath;
      if (sessionId) { uploadDir = path.join(WORKDIR, "sessions", sessionId, "workspace", "uploads"); relativePath = `sessions/${sessionId}/workspace/uploads/${safeName}`; }
      else { uploadDir = path.join(WORKDIR, "uploads", "_orphan"); relativePath = `uploads/_orphan/${safeName}`; }
      fs.mkdirSync(uploadDir, { recursive: true });
      const dest = path.join(uploadDir, safeName);
      fs.writeFileSync(dest, part.data);
      console.log("[Upload] Saved: " + dest + " (" + part.data.length + " bytes)");
      let entryCount = null;
      const ext = path.extname(safeName).toLowerCase();
      if (ext === ".zip") { try { const AdmZip = require("adm-zip"); const zip = new AdmZip(dest); entryCount = zip.getEntries().filter((e) => !e.isDirectory).length; } catch (e) { console.error("[Upload] Failed to read zip entries for " + safeName + ":", e.message); } }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: relativePath, size: part.data.length, entryCount: entryCount }));
    }).catch(() => { res.writeHead(413, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "File too large (max 50 MB)" })); });
    return;
  }

  // Session listing (GET) and creation (POST) - Claude-like new chat = new memory + empty workspace
  const urlPathNoQuery = urlPath;
  if (urlPathNoQuery === "/api/session" && req.method === "GET") {
    handleSessionList(req, res, userEmail);
    return;
  }
  if (urlPathNoQuery === "/api/session" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const opts = {
        hostname: "127.0.0.1",
        port: SYSTEM_PORT,
        path: "/session",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      };
      const proxyReq = require("http").request(opts, (proxyRes) => {
        let respBody = "";
        proxyRes.on("data", (c) => { respBody += c; });
        proxyRes.on("end", () => {
          try {
            const session = JSON.parse(respBody);
            const sid = session.id;
            if (sid && isValidSessionId(sid)) {
              const sessionWorkspace = require("path").join(WORKDIR, "sessions", sid, "workspace");
              try {
                if (require("fs").existsSync(sessionWorkspace)) {
                  require("fs").rmSync(sessionWorkspace, { recursive: true, force: true });
                }
                require("fs").mkdirSync(sessionWorkspace, { recursive: true });
                require("fs").mkdirSync(require("path").join(sessionWorkspace, "uploads"), { recursive: true });
                console.log(`[New Chat] Created empty workspace for ${sid}: ${sessionWorkspace} (Claude-like isolation)`);
              } catch (e) {
                console.error(`[New Chat] Failed to create workspace for ${sid}:`, e.message);
              }
              if (userEmail) {
                const owners = loadJson(OWNERS_FILE, {});
                owners[sid] = userEmail;
                saveJson(OWNERS_FILE, owners);
              }
            }
          } catch (e) {
            console.error("[New Chat] Failed to parse session creation response:", e.message);
          }
          res.writeHead(proxyRes.statusCode, { "Content-Type": "application/json" });
          res.end(respBody);
        });
      });
      proxyReq.on("error", (e) => {
        console.error("[New Chat] Proxy error:", e.message);
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to create session", detail: e.message }));
      });
      proxyReq.write(body);
      proxyReq.end();
    });
    return;
  }

  // Per-session operations
  const sessionId = extractSessionId(req);
  if (sessionId && userEmail) {
    if (!checkSessionOwnership(sessionId, userEmail, res)) return;
    const owners = loadJson(OWNERS_FILE, {});
    if (!owners[sessionId]) { owners[sessionId] = userEmail; saveJson(OWNERS_FILE, owners); }
  }

  const sessionMatch = urlPath.match(/^\/api\/session\/([^/?]+)$/);
  if (req.method === "DELETE" && sessionMatch) {
    const sid = decodeURIComponent(sessionMatch[1]);
    if (!isValidSessionId(sid)) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Invalid session ID format." })); return; }
    console.log(`[Session Cleanup] Deleting session ${sid}...`);
    const pathsToClean = [path.join(WORKDIR, "sessions", sid), path.join(WORKDIR, "uploads", sid)];
    for (const p of pathsToClean) {
      if (fs.existsSync(p)) { try { fs.rmSync(p, { recursive: true, force: true }); console.log(`[Session Cleanup] Removed: ${p}`); } catch (err) { console.error(`[Session Cleanup] Failed to remove ${p}:`, err.message); } }
    }
    const owners = loadJson(OWNERS_FILE, {});
    delete owners[sid];
    saveJson(OWNERS_FILE, owners);
    // Proxy the DELETE to OpenCode WITH the session's isolated workspace so the
    // instance also clears its internal message memory for this chat. Every other
    // route appends directory=; this was the only one missing it.
    const sessionWorkspace = path.join(WORKDIR, "sessions", sid, "workspace");
    const strippedUrl = req.url.startsWith("/api") ? req.url.slice(4) : req.url;
    const sep = strippedUrl.includes("?") ? "&" : "?";
    req.url = strippedUrl + sep + `directory=${encodeURIComponent(sessionWorkspace)}`;
    systemProxy.web(req, res);
    return;
  }

  // Route to system with workspace isolation
  const strippedUrl = req.url.slice(4) || "/";
  if (isGlobalRoute(urlPathNoQuery) || !sessionId) {
    req.url = strippedUrl;
    systemProxy.web(req, res);
    return;
  }

  // FIX: event endpoint needs /api prefix, message endpoint needs stripped
  try {
    const sessionWorkspace = path.join(WORKDIR, "sessions", sessionId, "workspace");
    try { fs.mkdirSync(sessionWorkspace, { recursive: true }); } catch {}
    const isEvent = req.url.includes("/event");
    const sep = req.url.includes("?") ? "&" : "?";
    const dirParam = `directory=${encodeURIComponent(sessionWorkspace)}`;
    if (isEvent) {
      req.url = req.url + sep + dirParam;
    } else {
      const stripped = req.url.startsWith("/api") ? req.url.slice(4) : req.url;
      req.url = stripped + (stripped.includes("?") ? "&" : "?") + dirParam;
    }
    systemProxy.web(req, res);
  } catch (err) {
    console.error(`[Proxy] Error routing to session ${sessionId}:`, err.message);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Failed to route to session", detail: err.message }));
  }
});

// WebSocket — always system for single event bus
server.on("upgrade", (req, socket, head) => {
  let token = (req.headers["x-auth-token"] || req.headers["authorization"] || "").replace(/^Bearer\s+/i, "").trim();
  if (!token && req.url.includes("token=")) {
    try { token = new URL(req.url, "http://localhost").searchParams.get("token") || ""; } catch (e) {}
  }
  const sessions = loadJson(SESSIONS_FILE, {});
  const users = loadJson(USERS_FILE, {});
  if (Object.keys(users).length > 0 && (!token || !sessions[token])) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  if (AUTH_PASSWORD && Object.keys(users).length === 0) {
    if (!checkBasicAuth(req)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
  }
  const sessionId = extractSessionId(req);
  if (sessionId) {
    const userEmail = sessions[token]?.email || null;
    if (userEmail) {
      const owners = loadJson(OWNERS_FILE, {});
      if (owners[sessionId] && owners[sessionId] !== userEmail) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
    }
  }
  // Always route WS to system for single event bus
  const strippedUrl = req.url.startsWith("/api") ? req.url.slice(4) : req.url;
  req.url = strippedUrl;
  systemProxy.ws(req, socket, head);
});

// Start
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on :${PORT} (frontend + proxy)`);
  console.log(`System OpenCode instance on port ${SYSTEM_PORT}`);
  console.log(`Workdir: ${WORKDIR}`);
  if (AUTH_PASSWORD) {
    console.log("🔒 Basic Auth protection is ENABLED.");
  } else {
    console.log("⚠️ No OPENCODE_SERVER_PASSWORD set; server is running unsecured.");
  }
});

function shutdown(signal) {
  console.log(`Received ${signal}. Shutting down...`);
  server.close(() => {
    console.log("HTTP server closed.");
    systemProxy.close(() => {
      console.log("Proxy closed.");
      process.exit(0);
    });
  });
  setTimeout(() => {
    console.error("Forcing shutdown after 10s timeout.");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
