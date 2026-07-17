/**
 * P1.2 — Session routes extracted
 * Preserves gate order, no body rewrites logic changed, just moved.
 */
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { loadJson, saveJson } from "../db.mjs";
import { isValidSessionId } from "../isolation.mjs";

const require = createRequire(import.meta.url);
import { SYSTEM_PORT } from "../config.mjs";

export function handleSessionList(_req, res, { userEmail, OWNERS_FILE }) {
  http
    .get(`http://127.0.0.1:${SYSTEM_PORT}/session`, (ocRes) => {
      let body = "";
      ocRes.on("data", (c) => (body += c));
      ocRes.on("end", () => {
        try {
          const sessions = JSON.parse(body || "[]");
          const owners = loadJson(OWNERS_FILE, {});
          const filtered = userEmail
            ? sessions.filter((s) => owners[s.id] === userEmail)
            : sessions;
          res.writeHead(ocRes.statusCode, { "Content-Type": "application/json" });
          res.end(JSON.stringify(filtered));
        } catch (_e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Failed to parse sessions" }));
        }
      });
    })
    .on("error", () => {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "OpenCode unreachable" }));
    });
}

export function handleSessionCreate(req, res, { WORKDIR, OWNERS_FILE, userEmail }) {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    const preIsolationDir = path.join(
      WORKDIR,
      "sessions",
      "_new-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10),
    );
    try {
      fs.mkdirSync(preIsolationDir, { recursive: true });
      fs.mkdirSync(path.join(preIsolationDir, "uploads"), { recursive: true });
    } catch (e) { console.warn("Ignored error:", e); }

    const opts = {
      hostname: "127.0.0.1",
      port: SYSTEM_PORT,
      path: "/session?directory=" + encodeURIComponent(preIsolationDir),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const proxyReq = http.request(opts, (proxyRes) => {
      let respBody = "";
      proxyRes.on("data", (c) => {
        respBody += c;
      });
      proxyRes.on("end", () => {
        try {
          const session = JSON.parse(respBody);
          const sid = session.id;
          if (sid && isValidSessionId(sid)) {
            const sessionWorkspace = path.join(WORKDIR, "sessions", sid, "workspace");
            try {
              fs.mkdirSync(path.dirname(sessionWorkspace), { recursive: true });
              if (fs.existsSync(sessionWorkspace)) {
                fs.rmSync(sessionWorkspace, { recursive: true, force: true });
              }
              if (fs.existsSync(preIsolationDir)) {
                fs.renameSync(preIsolationDir, sessionWorkspace);
              } else {
                fs.mkdirSync(sessionWorkspace, { recursive: true });
                fs.mkdirSync(path.join(sessionWorkspace, "uploads"), { recursive: true });
              }
              const moveBody = JSON.stringify({
                sessionID: sid,
                destination: { directory: sessionWorkspace },
                moveChanges: false,
              });
              const moveReq = http.request(
                {
                  hostname: "127.0.0.1",
                  port: SYSTEM_PORT,
                  path: "/experimental/control-plane/move-session",
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(moveBody),
                  },
                },
                (mr) => {
                  let mb = "";
                  mr.on("data", (c) => (mb += c));
                  mr.on("end", () => {
                    if (mr.statusCode !== 204) {
                      console.error(
                        `[New Chat] move-session for ${sid} → HTTP ${mr.statusCode}: ${mb.slice(0, 200)}`,
                      );
                    }
                  });
                },
              );
              moveReq.on("error", (e) =>
                console.error(`[New Chat] move-session failed for ${sid}:`, e.message),
              );
              moveReq.write(moveBody);
              moveReq.end();
            } catch (e) {
              console.error(`[New Chat] Failed to setup workspace for ${sid}:`, e.message);
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
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to create session", detail: e.message }));
    });
    proxyReq.write(body);
    proxyReq.end();
  });
}

export function handleSessionDelete(
  req,
  res,
  { WORKDIR, OWNERS_FILE, userEmail, sessionMatch, selfImproveDir, systemProxy },
) {
  const sid = decodeURIComponent(sessionMatch[1]);
  if (!isValidSessionId(sid)) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid session ID format." }));
    return;
  }
  try {
    const auditLine = `${new Date().toISOString()} DELETE session=${sid} user=${userEmail || "anon"} ip=${req.socket.remoteAddress || "?"}\n`;
    fs.appendFileSync(path.join(WORKDIR, "audit.log"), auditLine);
  } catch (e) { console.warn("Ignored error:", e); }

  const pathsToClean = [path.join(WORKDIR, "sessions", sid), path.join(WORKDIR, "uploads", sid)];
  const removeAll = () => {
    for (const p of pathsToClean) {
      if (fs.existsSync(p)) {
        try {
          fs.rmSync(p, { recursive: true, force: true });
        } catch (err) {
          console.error(`[Full-Purge] Failed to remove ${p}:`, err.message);
        }
      }
    }
  };
  removeAll();

  try {
    const owners = loadJson(OWNERS_FILE, {});
    delete owners[sid];
    saveJson(OWNERS_FILE, owners);
  } catch (e) { console.warn("Ignored error:", e); }
  try {
    const dbPath = path.join(WORKDIR, "opencode.db");
    if (fs.existsSync(dbPath)) {
      const Database = require("better-sqlite3");
      const uidb = new Database(dbPath);
      uidb.prepare("DELETE FROM session_owners WHERE session_id = ?").run(sid);
      uidb.close();
    }
  } catch (e) {
    console.error("[Full-Purge] session_owners DELETE failed:", e.message);
  }

  try {
    const backupsDir = path.join(WORKDIR, "backups");
    if (fs.existsSync(backupsDir)) {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      for (const f of fs.readdirSync(backupsDir)) {
        try {
          const fp = path.join(backupsDir, f);
          const st = fs.statSync(fp);
          if (st.isFile() && st.mtimeMs < cutoff) fs.unlinkSync(fp);
        } catch (e) { console.warn("Ignored error:", e); }
      }
    }
  } catch (e) { console.warn("Ignored error:", e); }

  const sessionWorkspace = path.join(WORKDIR, "sessions", sid, "workspace");
  const strippedUrl = req.url.startsWith("/api") ? req.url.slice(4) : req.url;
  const sep = strippedUrl.includes("?") ? "&" : "?";
  const deleteDir = selfImproveDir || sessionWorkspace;
  req.url = `${strippedUrl + sep}directory=${encodeURIComponent(deleteDir)}`;

  res.on("close", () => {
    setTimeout(() => {
      try {
        removeAll();
      } catch (e) { console.warn("Ignored error:", e); }
    }, 500);
  });

  systemProxy.web(req, res);
}
