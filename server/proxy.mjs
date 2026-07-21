/**
 * Релиз 5 (Пакет 3): HTTP/WS/SSE-прокси вынесен из server/index.mjs
 * без изменений логики: буферизация SSE отключена, heartbeat каждые 15с,
 * нумерация кадров + replay по Last-Event-ID из кольцевого буфера (sse-ring.mjs),
 * очистка протухших сессий при 404, WebSocket-upgrade проброс.
 */
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { WORKDIR } from "./config.mjs";
import { logger } from "./logger.mjs";
import { SSE_RING_SIZE, sseRingFor } from "./sse-ring.mjs";

const require = createRequire(import.meta.url);

export function createProxy(targetBase) {
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
        if (process.env.RUNNER_ISOLATION === "1") {
          res.writeHead(404, headers);
          proxyRes.pipe(res);
          return;
        }
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
        // Релиз 4: нумерация кадров + replay пропущенного по Last-Event-ID.
        let ringKey = "global";
        let lastEventId = Number.NaN;
        try {
          const u = new URL(req.url, "http://localhost");
          ringKey = u.searchParams.get("sessionId") || u.pathname;
          lastEventId = parseInt(
            req.headers["last-event-id"] ||
              u.searchParams.get("lastEventId") ||
              "",
            10,
          );
        } catch {
          /* остаёмся на дефолтах */
        }
        const ring = sseRingFor(ringKey);
        if (Number.isFinite(lastEventId)) {
          for (const f of ring.frames) {
            if (f.seq > lastEventId)
              res.write(`${f.payload}\nid: ${f.seq}\n\n`);
          }
        }
        let sseBuf = "";
        proxyRes.on("data", (chunk) => {
          sseBuf += chunk.toString("utf8").replace(/\r\n/g, "\n");
          let out = "";
          let idx = sseBuf.indexOf("\n\n");
          while (idx !== -1) {
            const frame = sseBuf.slice(0, idx);
            sseBuf = sseBuf.slice(idx + 2);
            idx = sseBuf.indexOf("\n\n");
            // Комментарии/пустые кадры (keep-alive) пропускаем без номера.
            const isComment = frame
              .split("\n")
              .every((l) => l === "" || l.startsWith(":"));
            if (isComment) {
              out += `${frame}\n\n`;
              continue;
            }
            const seq = ring.nextSeq++;
            ring.frames.push({ seq, payload: frame });
            if (ring.frames.length > SSE_RING_SIZE) ring.frames.shift();
            // Наш id — последним полем кадра: по спеке SSE действует
            // последнее встреченное поле id.
            out += `${frame}\nid: ${seq}\n\n`;
          }
          if (out && !res.write(out)) proxyRes.pause();
        });
        res.on("drain", () => proxyRes.resume());
        proxyRes.on("end", () => {
          cleanup();
          res.end();
        });
        // Апстрим умер посреди стрима: завершаем ответ корректным последним
        // чанком вместо res.destroy() — иначе браузер логирует
        // net::ERR_INCOMPLETE_CHUNKED_ENCODING. EventSource переподключится
        // сам и доберёт пропущенные кадры по Last-Event-ID из кольцевого
        // буфера (sse-ring.mjs).
        const endGracefully = () => {
          cleanup();
          if (!res.writableEnded && !res.destroyed) {
            try {
              res.write(": upstream-lost\n\n");
            } catch {
              /* сокет уже закрыт */
            }
            res.end();
          }
        };
        proxyRes.on("aborted", endGracefully);
        proxyRes.on("error", endGracefully);
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
