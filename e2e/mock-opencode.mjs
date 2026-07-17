#!/usr/bin/env node
import crypto from "node:crypto";
/**
 * Minimal deterministic OpenCode HTTP/SSE double for CI E2E.
 * It exercises the UI proxy, auth, session ownership and chat paths without
 * installing or calling a real model provider.
 */
import http from "node:http";

const port = Number(process.env.MOCK_OPENCODE_PORT || 4096);
const sessions = new Map();
const messages = new Map();

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function sessionIdFromPath(pathname) {
  return pathname.match(/^\/session\/(ses_[A-Za-z0-9_-]+)/)?.[1] || null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const { pathname } = url;

  if (pathname === "/global/health" || pathname === "/health") {
    return sendJson(res, 200, { status: "ok", mock: true });
  }
  if (pathname === "/config/providers") {
    return sendJson(res, 200, {
      providers: [{ id: "opencode", name: "OpenCode", models: {} }],
      default: {},
    });
  }
  if (pathname === "/provider")
    return sendJson(res, 200, { connected: [], all: [], default: {} });
  if (pathname === "/experimental/control-plane/move-session")
    return sendJson(res, 204, {});
  if (pathname === "/file" || pathname === "/file/status")
    return sendJson(res, 200, []);
  if (pathname === "/file/content")
    return sendJson(res, 200, {
      path: url.searchParams.get("path") || "",
      content: "",
    });

  if (pathname === "/event") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    res.write(": mock event stream\n\n");
    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 10_000);
    req.on("close", () => clearInterval(heartbeat));
    return;
  }

  if (pathname === "/session" && req.method === "GET")
    return sendJson(res, 200, [...sessions.values()]);
  if (pathname === "/session" && req.method === "POST") {
    const body = await readJson(req);
    const id = `ses_${crypto.randomBytes(8).toString("hex")}`;
    const now = Date.now();
    const session = {
      id,
      title: body.title || "New chat",
      time: { created: now, updated: now },
    };
    sessions.set(id, session);
    messages.set(id, []);
    return sendJson(res, 200, session);
  }

  const sessionId = sessionIdFromPath(pathname);
  if (sessionId && !sessions.has(sessionId))
    return sendJson(res, 404, { error: "session not found" });
  if (sessionId && pathname.endsWith("/message") && req.method === "GET") {
    return sendJson(res, 200, messages.get(sessionId) || []);
  }
  if (sessionId && pathname.endsWith("/message") && req.method === "POST") {
    const body = await readJson(req);
    const text = body.parts?.find((part) => part.type === "text")?.text || "";
    const now = Date.now();
    const user = {
      id: `msg_${crypto.randomBytes(6).toString("hex")}`,
      role: "user",
      sessionID: sessionId,
      parts: [{ id: "part_user", type: "text", text }],
      time: { created: now, completed: now },
    };
    const assistant = {
      id: `msg_${crypto.randomBytes(6).toString("hex")}`,
      role: "assistant",
      sessionID: sessionId,
      parts: [
        { id: "part_assistant", type: "text", text: "Mock OpenCode response" },
      ],
      info: { finish: "stop", time: { created: now, completed: now } },
    };
    messages.get(sessionId).push(user, assistant);
    return sendJson(res, 200, assistant);
  }
  if (sessionId && req.method === "DELETE") {
    sessions.delete(sessionId);
    messages.delete(sessionId);
    return sendJson(res, 204, {});
  }
  if (sessionId && pathname.endsWith("/abort")) return sendJson(res, 204, {});
  if (
    sessionId &&
    (pathname.includes("/permission") || pathname.includes("/question"))
  )
    return sendJson(res, 200, { data: [] });

  return sendJson(res, 200, {});
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Mock OpenCode listening on http://127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
