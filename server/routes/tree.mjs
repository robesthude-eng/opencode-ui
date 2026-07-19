/**
 * Рекурсивный листинг воркспейса сессии одним запросом (Релиз 3).
 * Заменяет N+1 шторм запросов /file по раскрытым папкам из поллера
 * файлового дерева (Workspace.tsx). Ходит по тому же бинд-каталогу,
 * что и скачивание воркспейса (routes/download.mjs), без похода в раннер.
 *
 * Ограничения против гигантских воркспейсов: максимум TREE_MAX_ENTRIES
 * записей и TREE_MAX_DEPTH уровней; node_modules/.git и симлинки
 * пропускаются (симлинки — ещё и защита от выхода за пределы сессии).
 */
import fs from "node:fs";
import path from "node:path";
import { buildSafeWorkspacePath } from "../isolation.mjs";

const TREE_MAX_ENTRIES = Number(process.env.TREE_MAX_ENTRIES || 5000);
const TREE_MAX_DEPTH = Number(process.env.TREE_MAX_DEPTH || 8);
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".cache",
  "__pycache__",
  ".venv",
]);

export async function handleWorkspaceTree(
  req,
  res,
  { WORKDIR, extractSessionId },
) {
  try {
    const sessionId = extractSessionId(req);
    if (!sessionId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing sessionId" }));
      return;
    }

    const workspaceDir = buildSafeWorkspacePath(sessionId, WORKDIR);
    const out = [];
    const walk = (dir, rel, depth) => {
      if (depth > TREE_MAX_DEPTH || out.length >= TREE_MAX_ENTRIES) return;
      let items;
      try {
        items = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return; // ошибка одной папки не валит весь обход
      }
      for (const it of items) {
        if (out.length >= TREE_MAX_ENTRIES) return;
        if (it.isSymbolicLink()) continue;
        const isDir = it.isDirectory();
        if (isDir && SKIP_DIRS.has(it.name)) continue;
        const itemRel = rel ? `${rel}/${it.name}` : it.name;
        out.push({ path: itemRel, isDirectory: isDir });
        if (isDir) walk(path.join(dir, it.name), itemRel, depth + 1);
      }
    };

    if (fs.existsSync(workspaceDir)) walk(workspaceDir, "", 0);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(out));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e?.message || "tree listing failed" }));
  }
}
