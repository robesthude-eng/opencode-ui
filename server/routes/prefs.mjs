/**
 * Настройки пользователя (закреплённые чаты, выбранная модель) — хранятся
 * на сервере, чтобы синхронизироваться между браузерами и устройствами.
 *
 * GET /api/user/prefs — настройки текущего пользователя ({} для анонима).
 * PUT /api/user/prefs — частичное обновление: передаются только изменённые
 * ключи, остальные сохраняются. Неизвестные ключи отбрасываются.
 */
import { loadJson, saveJson } from "../db.mjs";

const MAX_PINNED = 500;
const MAX_ID_LEN = 128;

function sanitize(input) {
  const out = {};
  if (Array.isArray(input.pinnedSessions)) {
    out.pinnedSessions = input.pinnedSessions
      .filter((x) => typeof x === "string" && x.length <= MAX_ID_LEN)
      .slice(0, MAX_PINNED);
  }
  if (input.selectedModel === null) {
    out.selectedModel = null;
  } else if (
    input.selectedModel &&
    typeof input.selectedModel.providerID === "string" &&
    typeof input.selectedModel.modelID === "string"
  ) {
    out.selectedModel = {
      providerID: input.selectedModel.providerID.slice(0, MAX_ID_LEN),
      modelID: input.selectedModel.modelID.slice(0, MAX_ID_LEN),
    };
  }
  return out;
}

export function handleUserPrefs(req, res, { PREFS_FILE, userEmail }) {
  if (req.method === "GET") {
    const all = loadJson(PREFS_FILE, {});
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify((userEmail && all[userEmail]) || {}));
    return;
  }
  if (req.method === "PUT") {
    if (!userEmail) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not authenticated." }));
      return;
    }
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      let parsed;
      try {
        parsed = JSON.parse(body || "{}");
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body." }));
        return;
      }
      const patch = sanitize(parsed);
      const all = loadJson(PREFS_FILE, {});
      all[userEmail] = { ...(all[userEmail] || {}), ...patch };
      saveJson(PREFS_FILE, all);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, prefs: all[userEmail] }));
    });
    return;
  }
  res.writeHead(405, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Method not allowed." }));
}
