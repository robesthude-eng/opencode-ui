/**
 * Превью workspace сессии: GET /api/sandbox-proxy/:sessionId/*
 *
 * Раньше этого роута не существовало вовсе — вкладка Preview рендерила iframe
 * на URL, который падал в OpenCode-прокси и отдавал 404.
 *
 * v1 — статическая раздача файлов workspace выбранной сессии:
 *  - docroot выбирается автоматически: первый из dist/ build/ out/ ./ public/,
 *    в котором есть index.html (приоритет собранного вывода над исходником,
 *    чтобы vite-шаблон index.html с /src/main.tsx не перекрывал сборку);
 *  - запрос каталога → его index.html; путь без расширения и не найден →
 *    SPA-fallback на index.html docroot'а (работают клиентские роутеры);
 *  - если index.html нет нигде — дружелюбная заглушка с автообновлением,
 *    превью появится само, как только агент создаст файл.
 *
 * Безопасность:
 *  - auth и CSRF уже пройдены в index.mjs до вызова (роут под /api/);
 *  - ownership: checkSessionOwnership — чужую сессию не отдаём (инвариант #2);
 *  - пути: decode → запрет ".."-сегментов и NUL → resolve → префикс-проверка
 *    против workspace → realpath-проверка (symlink-побег наружу → 403/404);
 *  - Cache-Control: no-store — правки агента видны по первому Refresh;
 *  - CSP приложения (script-src 'self' и т.д.) переопределяется на
 *    превью-CSP: инлайн-скрипты и CDN (https:) работают, при этом
 *    frame-ancestors 'self' — встраивать превью может только сам app.
 */
import fs from "node:fs";
import path from "node:path";
import { checkSessionOwnership, getSessionWorkspace, isValidSessionId } from "./isolation.mjs";
import { logger } from "./logger.mjs";

export const PREVIEW_PREFIX = "/api/sandbox-proxy";

const DOCROOT_CANDIDATES = ["dist", "build", "out", ".", "public"];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
};

const PREVIEW_CSP = [
  "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "connect-src 'self' https: ws: wss:",
  "frame-ancestors 'self'",
].join("; ");

function contentTypeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function baseHeaders(contentType) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Content-Security-Policy": PREVIEW_CSP,
  };
}

function htmlPage(title, body, extraHead = "") {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${extraHead}
<style>
  body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;
       background:#202020;color:#a3a3a3;font:14px/1.6 ui-monospace,Menlo,monospace}
  .box{max-width:440px;padding:24px;text-align:center}
  h1{font-size:15px;color:#e7e7e7;margin:0 0 10px}
  code{background:#2a2a2a;border-radius:4px;padding:1px 5px;color:#e7e7e7}
</style>
</head>
<body><div class="box">${body}</div></body>
</html>`;
}

function sendHtml(res, status, html, isHead) {
  res.writeHead(status, baseHeaders("text/html; charset=utf-8"));
  res.end(isHead ? undefined : html);
}

function send404(res, isHead) {
  sendHtml(
    res,
    404,
    htmlPage("Не найдено", `<h1>404</h1><p>Файл не найден в workspace этой сессии.</p>`),
    isHead,
  );
}

function sendPlaceholder(res, isHead) {
  sendHtml(
    res,
    200,
    htmlPage(
      "Превью пусто",
      `<h1>Пока нечего показывать</h1>
       <p>В workspace нет <code>index.html</code>.</p>
       <p>Попросите агента создать <code>index.html</code> в корне
       или собрать проект в <code>dist/</code>.</p>
       <p>Страница обновится сама.</p>`,
      `<meta http-equiv="refresh" content="4">`,
    ),
    isHead,
  );
}

/**
 * Ищет docroot: первый кандидат с index.html.
 * Возвращает { docroot, docrootIndex|null } (fallback — корень workspace).
 */
function detectDocroot(workspace) {
  // 1. Стандартные места: dist/ build/ out/ ./ public/
  for (const candidate of DOCROOT_CANDIDATES) {
    const dir = candidate === "." ? workspace : path.join(workspace, candidate);
    const idx = path.join(dir, "index.html");
    try {
      if (fs.statSync(idx).isFile()) return { docroot: dir, docrootIndex: idx };
    } catch {
      // кандидат отсутствует — идём дальше
    }
  }
  // 2. Агент обычно кладёт проект в подпапку (checkers/, my-app/, …) —
  //    ищем index.html на один уровень глубже, свежие папки в приоритете.
  try {
    const skip = new Set(["uploads", "node_modules", "backups", "temp"]);
    const dirs = fs
      .readdirSync(workspace, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !skip.has(e.name) && !e.name.startsWith("."))
      .map((e) => path.join(workspace, e.name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    for (const dir of dirs) {
      for (const candidate of DOCROOT_CANDIDATES) {
        const d = candidate === "." ? dir : path.join(dir, candidate);
        const idx = path.join(d, "index.html");
        try {
          if (fs.statSync(idx).isFile()) return { docroot: d, docrootIndex: idx };
        } catch {
          // нет — следующий кандидат
        }
      }
    }
  } catch {
    // workspace нечитаем — вернём заглушку
  }
  return { docroot: workspace, docrootIndex: null };
}

export function handlePreviewRoute(req, res, ctx) {
  const { WORKDIR, OWNERS_FILE, userEmail, loadJson } = ctx;
  const method = (req.method || "GET").toUpperCase();
  const isHead = method === "HEAD";
  if (method !== "GET" && !isHead) {
    res.writeHead(405, { "Content-Type": "application/json", Allow: "GET, HEAD" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const urlPath = (req.url || "").split("?")[0];
  let rest = urlPath.slice(PREVIEW_PREFIX.length);
  if (rest.startsWith("/")) rest = rest.slice(1);
  const slash = rest.indexOf("/");
  const sid = slash === -1 ? rest : rest.slice(0, slash);
  let subPath = slash === -1 ? null : rest.slice(slash + 1);

  if (!isValidSessionId(sid)) {
    sendHtml(
      res,
      404,
      htmlPage("Нет сессии", `<h1>Превью недоступно</h1><p>Откройте чат и обновите превью.</p>`),
      isHead,
    );
    return;
  }
  if (!checkSessionOwnership(sid, userEmail, res, OWNERS_FILE, loadJson)) return;

  // Без завершающего слэша относительные URL страницы (./app.js) резолвились
  // бы в /api/sandbox-proxy/app.js мимо превью — редиректим на канонический вид.
  if (subPath === null) {
    res.writeHead(302, { Location: `${PREVIEW_PREFIX}/${sid}/`, "Cache-Control": "no-store" });
    res.end();
    return;
  }

  try {
    subPath = decodeURIComponent(subPath);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Bad path encoding" }));
    return;
  }
  const segments = subPath.split("/").filter(Boolean);
  if (subPath.includes("\0") || segments.some((s) => s === "..")) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Forbidden path" }));
    return;
  }

  let workspace;
  try {
    workspace = path.resolve(getSessionWorkspace(sid, WORKDIR));
  } catch {
    send404(res, isHead);
    return;
  }
  if (!fs.existsSync(workspace)) {
    sendPlaceholder(res, isHead);
    return;
  }

  const { docroot, docrootIndex } = detectDocroot(workspace);

  // Корень без index.html где-либо — заглушка с автообновлением.
  if (segments.length === 0 && !docrootIndex) {
    sendPlaceholder(res, isHead);
    return;
  }

  let target = path.resolve(docroot, segments.join("/"));
  if (target !== workspace && !target.startsWith(workspace + path.sep)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Forbidden path" }));
    return;
  }

  // Каталог → его index.html; не найдено без расширения → SPA-fallback.
  try {
    if (fs.statSync(target).isDirectory()) target = path.join(target, "index.html");
  } catch {
    // target не существует — разберёмся ниже
  }
  if (!fs.existsSync(target)) {
    const lastSegment = segments[segments.length - 1] ?? "";
    if (docrootIndex && path.extname(lastSegment) === "") {
      target = docrootIndex; // SPA-роутер: /about → index.html
    } else {
      send404(res, isHead);
      return;
    }
  }

  // Symlink-побег за пределы workspace → отказ (защита в глубину).
  let real;
  try {
    const workspaceReal = fs.realpathSync(workspace);
    real = fs.realpathSync(target);
    if (real !== workspaceReal && !real.startsWith(workspaceReal + path.sep)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Forbidden path" }));
      return;
    }
  } catch {
    send404(res, isHead);
    return;
  }

  let size = null;
  try {
    const st = fs.statSync(real);
    if (!st.isFile()) {
      send404(res, isHead);
      return;
    }
    size = st.size;
  } catch {
    send404(res, isHead);
    return;
  }

  const headers = baseHeaders(contentTypeFor(real));
  headers["Content-Length"] = size;
  res.writeHead(200, headers);
  if (isHead) {
    res.end();
    return;
  }
  const stream = fs.createReadStream(real);
  stream.on("error", (err) => {
    logger.warn({ err: err.message, sid, file: real }, "Preview stream error");
    res.destroy();
  });
  stream.pipe(res);
}
