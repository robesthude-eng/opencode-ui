/**
 * Production server bootstrap — P1.2 target <500 lines, Variant A multiple similar at once
 * Gate order preserved, delegates to routes/*.mjs
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildClearSessionCookie,
  checkAuth,
  checkCsrf,
  extractToken,
  getUserEmail,
  isAdmin,
  isSessionExpired,
  loadUserKeys,
  saveUserKeys,
} from "./auth.mjs";
import { startBackupScheduler } from "./backup.mjs";
import {
  MAX_JSON_BODY_BYTES,
  OWNERS_FILE,
  PORT,
  SESSIONS_FILE,
  SYSTEM_PORT,
  USER_KEYS_DIR,
  USERS_FILE,
  WORKDIR,
} from "./config.mjs";
import { closeDb, initDb, loadJson, saveAuthJson, saveJson } from "./db.mjs";
import { startPrStatusPoller } from "./github-pr.mjs";
import {
  checkSessionOwnership,
  extractSessionId,
  getSessionWorkspace,
  isGlobalRoute,
  isValidSessionId,
  resolveTargetUrl as resolveIsolatedTargetUrl,
} from "./isolation.mjs";
import { logger } from "./logger.mjs";
import {
  checkRateLimit,
  checkUploadRateLimit,
  readBody,
  setSecurityHeaders,
} from "./middleware.mjs";
import { handlePreviewRoute, PREVIEW_PREFIX } from "./preview.mjs";
import {
  ensureRunner,
  getRunnerInfo,
  hasRunner,
  RUNNER_WORKSPACE,
  RUNNERS_ENABLED,
  runnerTarget,
  startRunnerReaper,
} from "./runner.mjs";

// Прокси к контейнерам-раннерам сессий (создаются лениво, кэшируются по sid).
const runnerProxies = new Map();
function getRunnerProxy(sid) {
  let proxy = runnerProxies.get(sid);
  if (!proxy) {
    proxy = createProxy(runnerTarget(sid));
    runnerProxies.set(sid, proxy);
  }
  return proxy;
}

import { checkUserRateLimit } from "./rate-limit.mjs";
import {
  handleLogin as handleAuthLogin,
  handleLogout as handleAuthLogout,
  handleMe as handleAuthMe,
  handleRegister as handleAuthRegister,
} from "./routes/auth.mjs";
import { handleCustomAuthRoute } from "./routes/customAuth.mjs";
import {
  getSelfImproveSessionId,
  isSelfImproveEnabled,
  isSiInternalRequest,
  promoteDistSnapshot,
} from "./self-improve.mjs";
import { captureServerException, initSentryServer } from "./sentry.mjs";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST = path.join(__dirname, "..", "dist");
initDb(WORKDIR);
const SESSION_TTL_MS =
  parseInt(process.env.OPENCODE_SESSION_TTL_MS || "", 10) ||
  7 * 24 * 60 * 60 * 1000;
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
function createProxy(targetBase) {
  const targetUrl = new URL(targetBase);
  function web(req, res) {
    const opts = {
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: `${targetUrl.hostname}:${targetUrl.port}`,
      },
    };
    delete opts.headers.connection;
    delete opts.headers.upgrade;
    const sessionMsgMatch = req.url.match(
      /\/session\/(ses_[A-Za-z0-9]+)\/(message|abort)/,
    );
    const proxyReq = http.request(opts, (proxyRes) => {
      const headers = { ...proxyRes.headers };
      const isEventStream = (headers["content-type"] || "").includes(
        "text/event-stream",
      );
      if (isEventStream) {
        // SSE must reach EventSource as soon as each upstream chunk arrives.
        // Explicitly disable intermediary buffering/compression and keep the
        // connection alive with comment heartbeats for reverse proxies.
        headers["x-accel-buffering"] = "no";
        headers["cache-control"] = "no-cache, no-transform";
        headers.connection = "keep-alive";
        delete headers["content-length"];
        delete headers["content-encoding"];
      }
      if (proxyRes.statusCode === 404 && sessionMsgMatch) {
        const staleSid = sessionMsgMatch[1];
        proxyRes.resume();
        try {
          const dbPath = path.join(WORKDIR, "opencode.db");
          if (fs.existsSync(dbPath)) {
            try {
              const Database = require("better-sqlite3");
              const db = new Database(dbPath);
              db.prepare("DELETE FROM session_owners WHERE session_id = ?").run(
                staleSid,
              );
              db.close();
            } catch (e) {
              console.error(e.message);
            }
          }
          const stalePath = path.join(WORKDIR, "sessions", staleSid);
          if (fs.existsSync(stalePath)) {
            try {
              fs.rmSync(stalePath, { recursive: true, force: true });
            } catch (e) {
              logger.error({ err: e }, "Ignored error");
            }
          }
        } catch (e) {
          console.error(e.message);
        }
        if (!res.headersSent) {
          res.writeHead(410, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "session_gone", sessionId: staleSid }),
          );
        }
        return;
      }
      res.writeHead(proxyRes.statusCode || 502, headers);
      if (isEventStream) {
        // Flush headers immediately instead of waiting for the first token.
        res.flushHeaders?.();
        res.socket?.setNoDelay(true);
        const heartbeat = setInterval(() => {
          if (!res.writableEnded && !res.destroyed)
            res.write(": keep-alive\n\n");
        }, 15000);
        const cleanup = () => clearInterval(heartbeat);
        res.on("close", cleanup);
        proxyRes.on("data", (chunk) => {
          if (!res.write(chunk)) proxyRes.pause();
        });
        res.on("drain", () => proxyRes.resume());
        proxyRes.on("end", () => {
          cleanup();
          res.end();
        });
        proxyRes.on("aborted", () => {
          cleanup();
          res.destroy();
        });
        proxyRes.on("error", () => {
          cleanup();
          res.destroy();
        });
        return;
      }
      proxyRes.pipe(res);
    });
    proxyReq.on("error", (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "OpenCode unreachable",
            detail: err.message,
          }),
        );
      } else {
        res.end();
      }
    });
    req.pipe(proxyReq);
  }
  function ws(req, socket, head) {
    const opts = {
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: req.url,
      method: "GET",
      headers: req.headers,
    };
    const proxyReq = http.request(opts);
    proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
      socket.write(
        `HTTP/${proxyRes.httpVersion} 101 ${proxyRes.statusMessage}\r\n`,
      );
      for (const [k, v] of Object.entries(proxyRes.headers)) {
        socket.write(`${k}: ${v}\r\n`);
      }
      socket.write("\r\n");
      if (proxyHead?.length) proxySocket.unshift(proxyHead);
      if (head?.length) socket.unshift(head);
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);
    });
    proxyReq.on("error", () => {
      socket.end();
    });
    proxyReq.end();
  }
  function close(cb) {
    if (cb) cb();
  }
  return { web, ws, close };
}
const systemProxy = createProxy(`http://127.0.0.1:${SYSTEM_PORT}`);
function serveStatic(req, res) {
  let urlPath = req.url.split("?")[0];
  if (urlPath === "/") urlPath = "/index.html";
  let filePath = path.join(DIST, urlPath);
  if (!filePath.startsWith(DIST + path.sep) && filePath !== DIST) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory())
    filePath = path.join(DIST, "index.html");
  const ext = path.extname(filePath);
  const contentType = MIME[ext] || "application/octet-stream";
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500);
      res.end("Internal error");
      return;
    }
    const headers = { "Content-Type": contentType };
    if (urlPath === "/index.html")
      headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
    else if (
      ext === ".js" ||
      ext === ".css" ||
      ext.match(/\.(png|jpg|svg|woff2?|ico)/)
    )
      headers["Cache-Control"] = "public, max-age=31536000, immutable";
    setSecurityHeaders(res);
    res.writeHead(200, headers);
    res.end(data);
  });
}
const server = http.createServer(async (req, res) => {
  setSecurityHeaders(res);
  if (
    req.url === "/health" ||
    req.url === "/global/health" ||
    req.url === "/api/global/health"
  ) {
    const ocUrl = `http://127.0.0.1:${SYSTEM_PORT}/global/health`;
    let sent = false;
    const send = (code, body) => {
      if (sent) return;
      sent = true;
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const r = http.get(ocUrl, { timeout: 1500 }, (pr) => {
      if (pr.statusCode >= 200 && pr.statusCode < 400)
        send(200, {
          status: "ok",
          opencode: "healthy",
          uptime: process.uptime(),
        });
      else
        send(503, {
          status: "error",
          opencode: `unhealthy_${pr.statusCode}`,
          uptime: process.uptime(),
        });
    });
    r.on("error", (e) =>
      send(503, {
        status: "error",
        opencode: `unreachable_${e.message}`,
        uptime: process.uptime(),
      }),
    );
    r.on("timeout", () => {
      r.destroy();
      send(503, {
        status: "error",
        opencode: "timeout",
        uptime: process.uptime(),
      });
    });
    return;
  }
  const urlPath = req.url.split("?")[0];
  const isSiInternal = isSiInternalRequest(WORKDIR, req, urlPath);
  if (urlPath === "/auth/register" || urlPath === "/api/auth/register") {
    handleAuthRegister(req, res, { USERS_FILE, SESSIONS_FILE, SESSION_TTL_MS });
    return;
  }
  if (urlPath === "/auth/login" || urlPath === "/api/auth/login") {
    handleAuthLogin(req, res, { USERS_FILE, SESSIONS_FILE, SESSION_TTL_MS });
    return;
  }
  if (urlPath === "/auth/me" || urlPath === "/api/auth/me") {
    handleAuthMe(req, res, {
      USERS_FILE,
      SESSIONS_FILE,
      SESSION_TTL_MS,
      getUserEmail,
    });
    return;
  }
  if (urlPath === "/auth/logout" || urlPath === "/api/auth/logout") {
    handleAuthLogout(req, res, {
      SESSIONS_FILE,
      extractToken,
      saveAuthJson,
      buildClearSessionCookie,
      loadJson,
    });
    return;
  }
  if (!req.url.startsWith("/api/") && req.url !== "/api") {
    serveStatic(req, res);
    return;
  }
  if (!isSiInternal) {
    if (!checkAuth(req, res, USERS_FILE, SESSIONS_FILE, SESSION_TTL_MS)) return;
  }
  if (!isSiInternal && !checkCsrf(req, res)) return;
  let userEmail = getUserEmail(req, SESSIONS_FILE, SESSION_TTL_MS);
  if (!userEmail && isSiInternal) userEmail = "si-agent@internal";
  const heavy =
    /\/message$|\/question\/[^/]+\/(reply|reject)$|\/sandbox\/|\/rebuild$|\/reset-ui$|\/git\/rollback$|\/workspace\/upload/.test(
      urlPath,
    );
  if (heavy && req.method !== "GET" && req.method !== "HEAD") {
    if (
      !(await checkUserRateLimit(req, res, userEmail || "anon", {
        limit: 120,
        windowMs: 60000,
        bucket: "heavy",
      }))
    )
      return;
  }
  const isRequestAdmin = isAdmin(userEmail, USERS_FILE) || isSiInternal;

  // Delegate to route modules — P1.2 multiple similar at once
  // Превью workspace сессии (auth/CSRF уже пройдены выше; ownership — внутри).
  if (urlPath === PREVIEW_PREFIX || urlPath.startsWith(`${PREVIEW_PREFIX}/`)) {
    handlePreviewRoute(req, res, { WORKDIR, OWNERS_FILE, userEmail, loadJson });
    return;
  }
  if (
    handleCustomAuthRoute(
      req,
      res,
      userEmail,
      loadUserKeys,
      saveUserKeys,
      readBody,
      MAX_JSON_BODY_BYTES,
    )
  ) {
    return;
  }
  if (urlPath.startsWith("/api/sandbox/")) {
    if (!userEmail) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    if (!isRequestAdmin) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: "Admin access required for sandbox feature." }),
      );
      return;
    }
    if (!isSelfImproveEnabled(WORKDIR)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Self-Improvement Mode is disabled on the server.",
        }),
      );
      return;
    }
    import("./sandbox.mjs")
      .then((m) => {
        m.handleSandboxRequest(req, res, WORKDIR, userEmail);
      })
      .catch((err) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Failed to load sandbox module",
            detail: err.message,
          }),
        );
      });
    return;
  }

  // Self-improve routes via dynamic import to keep bootstrap small (<500 lines target)
  if (
    urlPath === "/api/settings/self-improve" ||
    urlPath === "/api/settings/self-improve/session" ||
    urlPath === "/api/self-improve/resync" ||
    urlPath === "/api/self-improve/create-pr" ||
    urlPath === "/api/self-improve/prs" ||
    urlPath === "/api/rebuild" ||
    urlPath === "/api/reset-ui" ||
    urlPath === "/api/git/checkpoint" ||
    urlPath === "/api/git/checkpoints" ||
    urlPath === "/api/dist/snapshots" ||
    urlPath === "/api/dist/rollback" ||
    urlPath === "/api/git/rollback" ||
    urlPath === "/api/self-improve/proposals" ||
    urlPath.startsWith("/api/self-improve/proposals/")
  ) {
    import("./routes/self-improve.mjs")
      .then((mod) => {
        mod.handleSelfImproveRoute(req, res, {
          WORKDIR,
          userEmail,
          isRequestAdmin,
          isInternalRequest: isSiInternal,
        });
      })
      .catch((e) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      });
    return;
  }

  // Database & Backup routes via dynamic import to keep bootstrap small
  if (
    urlPath === "/api/db/backups" ||
    urlPath === "/api/db/backup" ||
    urlPath === "/api/db/backup/restore" ||
    urlPath === "/api/db/audit" ||
    urlPath === "/api/db/diff" ||
    urlPath.startsWith("/api/db/backup/download/")
  ) {
    import("./routes/backup.mjs")
      .then((mod) => {
        mod.handleBackupRoute(req, res, {
          WORKDIR,
          userEmail,
          isRequestAdmin,
          checkRateLimit,
        });
      })
      .catch((e) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      });
    return;
  }

  // Session routes
  const urlPathNoQuery = urlPath;
  if (urlPathNoQuery === "/api/session" && req.method === "GET") {
    import("./routes/session.mjs").then((m) => {
      m.handleSessionList(req, res, { userEmail, OWNERS_FILE });
    });
    return;
  }
  if (urlPathNoQuery === "/api/session" && req.method === "POST") {
    import("./routes/session.mjs").then((m) => {
      m.handleSessionCreate(req, res, { WORKDIR, OWNERS_FILE, userEmail });
    });
    return;
  }
  const sessionId = extractSessionId(req);
  if (sessionId && userEmail) {
    if (
      !checkSessionOwnership(sessionId, userEmail, res, OWNERS_FILE, loadJson)
    )
      return;
    const owners = loadJson(OWNERS_FILE, {});
    if (!owners[sessionId]) {
      owners[sessionId] = userEmail;
      saveJson(OWNERS_FILE, owners);
    }
  }
  const siSessionId = getSelfImproveSessionId(WORKDIR);
  const isSelfImproveSession =
    isSelfImproveEnabled(WORKDIR) && !!siSessionId && sessionId === siSessionId;
  const selfImproveDir = isSelfImproveSession
    ? getSessionWorkspace(sessionId, WORKDIR)
    : null;
  const sessionMatch = urlPath.match(/^\/api\/session\/([^/?]+)$/);
  if (req.method === "DELETE" && sessionMatch) {
    import("./routes/session.mjs").then((m) => {
      m.handleSessionDelete(req, res, {
        WORKDIR,
        OWNERS_FILE,
        userEmail,
        sessionMatch,
        selfImproveDir,
        systemProxy,
      });
    });
    return;
  }
  if (urlPath === "/api/workspace/download" && req.method === "GET") {
    import("./routes/download.mjs").then((m) => {
      m.handleDownload(req, res, { WORKDIR, extractSessionId });
    });
    return;
  }
  if (urlPath === "/api/workspace/upload-folder" && req.method === "POST") {
    import("./routes/upload.mjs").then((m) => {
      m.handleUploadFolder(req, res, {
        WORKDIR,
        extractSessionId,
        checkUploadRateLimit,
      });
    });
    return;
  }
  if (urlPath === "/api/workspace/upload" && req.method === "POST") {
    import("./routes/upload.mjs").then((m) => {
      m.handleUpload(req, res, { WORKDIR, checkUploadRateLimit });
    });
    return;
  }

  const strippedUrl = req.url.slice(4) || "/";
  if (isGlobalRoute(urlPathNoQuery) || !sessionId) {
    req.url = strippedUrl;
    systemProxy.web(req, res);
    return;
  }
  // Инфо о контейнере-раннере сессии (статус, опубликованные порты приложений
  // пользователя — например, WS-сервер игры на 3001).
  const runnerInfoMatch = urlPath.match(/^\/api\/session\/([^/?]+)\/runner$/);
  if (RUNNERS_ENABLED && runnerInfoMatch && req.method === "GET") {
    getRunnerInfo(sessionId)
      .then((info) => {
        res.writeHead(info ? 200 : 404, {
          "Content-Type": "application/json",
        });
        res.end(
          JSON.stringify(info || { error: "no runner for this session" }),
        );
      })
      .catch((e) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      });
    return;
  }
  // Изоляция «новый чат = новый контейнер»: сессии из реестра раннеров
  // обслуживаются собственным контейнером (directory=/session/workspace внутри
  // него). Legacy-сессии без раннера — по прежней схеме через системный инстанс.
  if (RUNNERS_ENABLED && !isSelfImproveSession && hasRunner(sessionId)) {
    ensureRunner(sessionId)
      .then(() => {
        const baseUrl = req.url.startsWith("/api") ? req.url.slice(4) : req.url;
        const urlObj = new URL(baseUrl, "http://localhost");
        urlObj.searchParams.set("directory", RUNNER_WORKSPACE);
        req.url = urlObj.pathname + urlObj.search;
        getRunnerProxy(sessionId).web(req, res);
      })
      .catch((err) => {
        logger.error(
          { sid: sessionId, err: err.message },
          "[runner] route failed",
        );
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Failed to reach session runner",
            detail: err.message,
          }),
        );
      });
    return;
  }
  try {
    const sessionWorkspace = getSessionWorkspace(sessionId, WORKDIR);
    try {
      fs.mkdirSync(sessionWorkspace, { recursive: true });
    } catch (e) {
      logger.warn({ err: e.message }, "Ignored error");
    }
    const effectiveWorkspace = selfImproveDir || sessionWorkspace;
    // Event routes must also have the /api prefix stripped: OpenCode serves
    // GET /event (not /api/event). Keep sessionId in the query so the
    // isolation resolver can append the correct per-session directory.
    const baseUrl = req.url.startsWith("/api") ? req.url.slice(4) : req.url;
    try {
      const resolved = resolveIsolatedTargetUrl(baseUrl, sessionId, WORKDIR);
      const urlObj = new URL(resolved, "http://localhost");
      urlObj.searchParams.set("directory", effectiveWorkspace);
      req.url = urlObj.pathname + (urlObj.search ? urlObj.search : "");
    } catch {
      const sep = baseUrl.includes("?") ? "&" : "?";
      req.url = `${baseUrl}${sep}directory=${encodeURIComponent(effectiveWorkspace)}`;
    }
    systemProxy.web(req, res);
  } catch (err) {
    console.error(
      `[Proxy] Error routing to session ${sessionId}:`,
      err.message,
    );
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Failed to route to session",
        detail: err.message,
      }),
    );
  }
});

server.on("upgrade", (req, socket, head) => {
  const upgradePath = (req.url || "").split("?")[0];
  // /socket.io — терминал: его upgrade обслуживает engine.io (terminal.mjs).
  // Раньше этот хендлер параллельно проксировал такие upgrade'ы в OpenCode —
  // висящий запрос к системному инстансу на каждое подключение терминала.
  if (upgradePath === "/socket.io" || upgradePath.startsWith("/socket.io/"))
    return;
  const token = extractToken(req, {
    allowQueryToken: upgradePath === "/api/event" || upgradePath === "/event",
  });
  const sessions = loadJson(SESSIONS_FILE, {});
  const users = loadJson(USERS_FILE, {});
  const session = token ? sessions[token] : null;
  // Upgrade requests do not pass through the HTTP handler. Enforce the same
  // TTL boundary here, delete an expired token immediately, and never proxy a
  // WebSocket using a stale session.
  if (session && isSessionExpired(session, SESSION_TTL_MS)) {
    delete sessions[token];
    saveJson(SESSIONS_FILE, sessions);
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  if (Object.keys(users).length > 0 && (!token || !session?.email)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  const sessionId = extractSessionId(req);
  if (sessionId) {
    const userEmail = session?.email || null;
    if (userEmail) {
      const owners = loadJson(OWNERS_FILE, {});
      if (owners[sessionId] && owners[sessionId] !== userEmail) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
    }
  }
  const strippedUrl = req.url.startsWith("/api") ? req.url.slice(4) : req.url;
  req.url = strippedUrl;
  // WebSocket-и раннер-сессий (например, /event) идут в контейнер сессии.
  if (RUNNERS_ENABLED && sessionId && hasRunner(sessionId)) {
    ensureRunner(sessionId)
      .then(() => getRunnerProxy(sessionId).ws(req, socket, head))
      .catch(() => {
        socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        socket.destroy();
      });
    return;
  }
  systemProxy.ws(req, socket, head);
});

setInterval(
  () => {
    try {
      const sessions = loadJson(SESSIONS_FILE, {});
      const now = Date.now();
      let mutated = false;
      for (const token in sessions) {
        if (
          SESSION_TTL_MS > 0 &&
          now - (sessions[token].createdAt || 0) > SESSION_TTL_MS
        ) {
          delete sessions[token];
          mutated = true;
        }
      }
      if (mutated) {
        saveJson(SESSIONS_FILE, sessions);
        logger.info("periodic session cleanup completed");
      }
    } catch (e) {
      logger.error({ err: e.message }, "periodic session cleanup failed");
    }
  },
  24 * 60 * 60 * 1000,
).unref();

import { initTerminalServer } from "./terminal.mjs";

void initSentryServer().finally(() => {
  initTerminalServer(server, { sessionTtlMs: SESSION_TTL_MS });
  server.listen(PORT, "0.0.0.0", () => {
    logger.info(
      { port: PORT, systemPort: SYSTEM_PORT, workdir: WORKDIR },
      "server listening",
    );
    if (Object.keys(loadJson(USERS_FILE, {})).length === 0) {
      logger.warn(
        "no users registered yet; first registered account becomes admin",
      );
    }
    try {
      startBackupScheduler(WORKDIR);
    } catch (e) {
      logger.warn({ err: e.message }, "backup scheduler failed");
    }
    try {
      startPrStatusPoller(WORKDIR);
    } catch (e) {
      logger.warn({ err: e.message }, "PR status poller failed");
    }
    try {
      const snap = promoteDistSnapshot();
      if (snap) logger.info({ snap }, "initial dist snapshot ready");
    } catch (e) {
      logger.warn({ err: e.message }, "initial dist snapshot failed");
    }
    if (RUNNERS_ENABLED) {
      startRunnerReaper();
      logger.info(
        "runner isolation enabled: each chat session gets its own container",
      );
    }
  });
});
function shutdown(signal) {
  logger.info({ signal }, "shutting down");
  server.close(() => {
    closeDb();
    systemProxy.close(() => {
      process.exit(0);
    });
  });
  setTimeout(() => {
    logger.error("forcing shutdown after 10s timeout");
    process.exit(1);
  }, 10000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  logger.error({ err: err?.message || String(err) }, "uncaughtException");
  captureServerException(err);
});
process.on("unhandledRejection", (reason) => {
  logger.error({ err: String(reason) }, "unhandledRejection");
  captureServerException(
    reason instanceof Error ? reason : new Error(String(reason)),
  );
});
