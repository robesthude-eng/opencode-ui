import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { api } from "../api/client";
import { useStore } from "../store/useStore";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  FileIcon,
  FolderIcon,
  FolderUploadIcon,
  DownloadIcon,
  GitBranchIcon,
  RefreshIcon,
  SearchIcon,
} from "./icons";

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeNode[];
  loaded?: boolean;
}

function toTree(nodes: { path: string; type?: string; isDirectory?: boolean }[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", isDir: true, children: [] };
  for (const n of nodes) {
    const parts = n.path.split("/").filter(Boolean);
    let cur = root;
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i];
      const isLast = i === parts.length - 1;
      const isDir = isLast ? !!(n.isDirectory ?? n.type === "directory") : true;
      let child = cur.children?.find((c) => c.name === parts[i]);
      if (!child) {
        child = {
          name: parts[i],
          path: acc,
          isDir,
          children: isDir ? [] : undefined,
          loaded: false,
        };
        cur.children?.push(child);
      }
      if (isDir) cur = child;
    }
  }
  const sort = (nodes: TreeNode[]): TreeNode[] => {
    nodes.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
    for (const n of nodes) if (n.children) sort(n.children);
    return nodes;
  };
  return sort(root.children ?? []);
}

function toRelPath(p: string): string {
  if (!p) return p;
  const m = p.match(/^\/app\/workspace\/sessions\/[^/]+\/workspace(\/.*)?$/);
  if (m) return m[1] ? m[1].replace(/^\//, "") : ".";
  if (p.startsWith("/app/workspace/")) return p.slice("/app/workspace/".length);
  return p;
}

const STATUS_COLORS: Record<string, string> = {
  modified: "#fbbf24",
  added: "#4ade80",
  untracked: "#60a5fa",
  deleted: "#f87171",
  renamed: "#60a5fa",
};

const HIDDEN_SEGMENTS = new Set([
  "node_modules",
  ".git",
  "dist",
  "dist-ssr",
  "coverage",
  ".vite",
  ".cache",
  ".turbo",
  ".next",
  ".arena",
  "__pycache__",
  ".config_opencode",
  ".opencode_data",
  ".local",
  ".config",
  ".users.json",
  ".sessions.json",
  ".session_owners.json",
  ".admin_password",
  ".self_improve_mode",
  "package-lock.json",
  "opencode.db",
  "opencode.db-wal",
  "opencode.db-shm",
  "backups",
]);

// Максимальная глубина рекурсивной перезагрузки раскрытых папок —
// страховка от патологически глубоких деревьев (ограничивает число запросов).
const DEEP_RELOAD_MAX_DEPTH = 8;

// Synthetic root node that surfaces the live project source (opencode-ui) in the
// Workspace. The server resolves its contents to /app/workspace/opencode-ui via a
// strict allowlist (see server/index.mjs handleSelfImproveFileProxy).
// Модульная константа (не в теле компонента): все обновления дерева создают
// новые объекты через spread и эту ноду не мутируют, а стабильная идентичность
// нужна, чтобы withSelfImproveRoot → refresh/autoRefresh → эффект поллинга
// не пересоздавались на каждом рендере (раньше любой рендер сбрасывал
// 8-секундный таймер setInterval).
const SELF_IMPROVE_NODE: TreeNode = {
  name: "opencode-ui",
  path: "opencode-ui",
  isDir: true,
  children: [],
  loaded: false,
};

export default function Workspace() {
  const workspaceOpen = useStore((s) => s.workspaceOpen);
  const setWorkspaceOpen = useStore((s) => s.setWorkspaceOpen);
  const selfImproveEnabled = useStore((s) => s.selfImproveEnabled);
  const currentID = useStore((s) => s.currentID);
  const selfImproveSessionId = useStore((s) => s.selfImproveSessionId);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const expandedRef = useRef<Set<string>>(expanded);
  const [activeFile, setActiveFile] = useState<{ path: string; content: string } | null>(null);
  const [filter, setFilter] = useState("");
  const [gitFiles, setGitFiles] = useState<{ path: string; status?: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const loadingDirs = useRef<Set<string>>(new Set());
  const loadGen = useRef(0);

  // Show the synthetic "opencode-ui" node for any session EXCEPT the dedicated
  // Self-Improvement chat — that chat's agent already operates directly on the
  // project source, so its own root IS the project (no duplicate node needed).
  const showSynthetic = selfImproveEnabled && currentID !== selfImproveSessionId;
  const withSelfImproveRoot = useCallback(
    (nodes: TreeNode[]): TreeNode[] => (showSynthetic ? [SELF_IMPROVE_NODE, ...nodes] : nodes),
    [showSynthetic],
  );

  const filterNodes = useCallback(
    (nodes: { path: string; type?: string; isDirectory?: boolean }[]) => {
      if (!Array.isArray(nodes)) return [];
      const mySessionIds = new Set(useStore.getState().sessions.map((s) => s.id));
      return nodes.filter((n) => {
        const raw = (n.path || "").replace(/\\/g, "/");
        const parts = raw.split("/").filter(Boolean);
        const p = parts[0] || "";

        if (parts.some((seg: string) => HIDDEN_SEGMENTS.has(seg))) return false;
        if (raw.endsWith(".tsbuildinfo") || raw.endsWith(".map")) return false;

        if (!selfImproveEnabled && p === "opencode-ui") return false;

        if (selfImproveEnabled && p === "opencode-ui" && parts.length >= 2) {
          const allowedTop = new Set([
            "src",
            "public",
            "index.html",
            "package.json",
            "vite.config.ts",
            "tsconfig.json",
            "tsconfig.node.json",
            "biome.json",
            "vitest.config.ts",
            "SELF_IMPROVE.md",
            "SELF_IMPROVE_GUIDE.md",
          ]);
          if (!allowedTop.has(parts[1])) return false;
        }

        if ((p === "sessions" || p === "uploads" || p === "temp") && parts.length > 1) {
          const sid = parts[1];
          if (sid?.startsWith("ses_") && !mySessionIds.has(sid)) return false;
        }
        return true;
      });
    },
    [selfImproveEnabled],
  );

  const loadDir = useCallback(
    async (path: string) => {
      if (!currentID || currentID.startsWith("tmp_")) return [];
      try {
        const nodes = await api.listDir(path, currentID);
        let tree = Array.isArray(nodes)
          ? toTree(filterNodes(nodes) as { path: string; type?: string; isDirectory?: boolean }[])
          : [];
        // Сервер возвращает пути от корня workspace — спускаемся до запрошенной
        // папки, чтобы не дублировать её как собственного ребёнка (checkers/checkers/…).
        if (path && path !== ".") {
          for (const seg of path.split("/").filter(Boolean)) {
            const next = tree.find((n) => n.name === seg && n.isDir);
            if (!next) break; // пути уже относительные — отдаём как есть
            tree = next.children ?? [];
          }
        }
        return tree;
      } catch (e: unknown) {
        throw e instanceof Error ? e : new Error(String(e));
      }
    },
    [currentID, filterNodes],
  );

  // Полная перезагрузка видимой части дерева: корень + рекурсивно содержимое
  // всех РАСКРЫТЫХ папок (включая синтетическую opencode-ui — её содержимое
  // сервер отдаёт тем же listDir через allowlist-прокси). Свёрнутые папки
  // остаются loaded:false и подгружаются заново при раскрытии — это осознанно:
  // при раскрытии пользователь получает свежие данные, а не кэш.
  // Раньше autoRefresh переиспользовал oldNode.children для раскрытых папок,
  // из-за чего файлы, созданные агентом внутри открытой папки, не появлялись
  // никогда; а refresh() сбрасывал дерево до корня, и раскрытые папки
  // выглядели пустыми до повторного клика.
  const loadTreeDeep = useCallback(async (): Promise<TreeNode[]> => {
    const rootNodes = await loadDir(".");
    const expandedPaths = expandedRef.current;
    const fill = async (nodes: TreeNode[], depth: number): Promise<TreeNode[]> =>
      Promise.all(
        nodes.map(async (n) => {
          if (!n.isDir || !expandedPaths.has(n.path) || depth >= DEEP_RELOAD_MAX_DEPTH) return n;
          try {
            const children = await fill(await loadDir(n.path), depth + 1);
            return { ...n, children, loaded: true };
          } catch {
            return n; // ошибка одной папки не валит всё дерево
          }
        }),
      );
    return fill(withSelfImproveRoot(rootNodes), 0);
  }, [loadDir, withSelfImproveRoot]);

  const refresh = useCallback(async () => {
    if (!currentID || currentID.startsWith("tmp_")) {
      setTree([]);
      setLoading(false);
      setError(null);
      return;
    }
    const gen = ++loadGen.current;
    setLoading(true);
    setError(null);
    try {
      const t = await loadTreeDeep();
      if (gen !== loadGen.current) return;
      setTree(t);
    } catch (e: unknown) {
      if (gen !== loadGen.current) return;
      setError((e as Error)?.message || "Не удалось загрузить файлы");
      setTree(withSelfImproveRoot([]));
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, [currentID, loadTreeDeep, withSelfImproveRoot]);

  const autoRefresh = useCallback(async () => {
    if (!currentID || currentID.startsWith("tmp_")) return;
    // Не бампаем loadGen (фоновый опрос не должен инвалидировать ручной
    // refresh), но запоминаем текущее значение: если за время запроса
    // сменилась сессия или прошёл ручной refresh — молча выбрасываем результат,
    // иначе setTree записал бы дерево чужой/устаревшей сессии.
    const gen = loadGen.current;
    try {
      const t = await loadTreeDeep();
      if (gen !== loadGen.current) return;
      setTree(t);
    } catch {
      // silent poll errors
    }
  }, [currentID, loadTreeDeep]);

  const loadGit = useCallback(async () => {
    if (!currentID || currentID.startsWith("tmp_")) {
      setGitFiles([]);
      return;
    }
    try {
      const files = await api.gitStatus(currentID);
      const list = Array.isArray(files) ? (files as { path: string; status?: string }[]) : [];
      setGitFiles(filterNodes(list));
    } catch {
      setGitFiles([]);
    }
  }, [currentID, filterNodes]);

  useEffect(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
    input.setAttribute("mozdirectory", "");
    input.style.display = "none";
    document.body.appendChild(input);
    folderInputRef.current = input;
    return () => {
      input.remove();
      folderInputRef.current = null;
    };
  }, []);

  // bind upload handler
  useEffect(() => {
    const input = folderInputRef.current;
    if (!input) return;
    const handler = async (e: Event) => {
      const el = e.target as HTMLInputElement;
      const fileList = el.files;
      if (!fileList || fileList.length === 0) return;
      const files: { path: string; file: File }[] = [];
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        const relPath =
          (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
        files.push({ path: relPath, file });
      }
      setUploading(true);
      setUploadTotal(files.length);
      setUploadProgress(0);
      setUploadMsg(`Uploading ${files.length} files…`);
      try {
        const BATCH = 20;
        for (let i = 0; i < files.length; i += BATCH) {
          const batch = files.slice(i, i + BATCH);
          await api.uploadFolder(batch);
          setUploadProgress(Math.min(i + BATCH, files.length));
        }
        setUploadMsg(`Done! ${files.length} file(s) uploaded.`);
        void refresh();
        setTimeout(() => setUploadMsg(null), 3000);
      } catch (err: unknown) {
        setUploadMsg(`Error: ${(err as Error).message}`);
        setTimeout(() => setUploadMsg(null), 5000);
      } finally {
        setUploading(false);
        el.value = "";
      }
    };
    input.addEventListener("change", handler);
    return () => input.removeEventListener("change", handler);
  }, [refresh]);

  expandedRef.current = expanded;

  useEffect(() => {
    if (!workspaceOpen || !currentID || currentID.startsWith("tmp_")) return;
    void refresh();
    void loadGit();
    const poll = setInterval(() => {
      void autoRefresh();
      void loadGit();
    }, 8000);
    return () => clearInterval(poll);
  }, [workspaceOpen, currentID, refresh, loadGit, autoRefresh]);

  useEffect(() => {
    setExpanded(new Set([""]));
    setActiveFile(null);
    setTree([]);
  }, []);

  const toggleDir = async (node: TreeNode) => {
    const next = new Set(expanded);
    expandedRef.current = next;
    if (next.has(node.path)) {
      next.delete(node.path);
    } else {
      next.add(node.path);
      if (!node.loaded && !loadingDirs.current.has(node.path)) {
        loadingDirs.current.add(node.path);
        try {
          const children = await loadDir(node.path);
          const update = (nodes: TreeNode[]): TreeNode[] =>
            nodes.map((n) => {
              if (n.path === node.path) return { ...n, children, loaded: true };
              if (n.children) return { ...n, children: update(n.children) };
              return n;
            });
          setTree((prev) => update(prev));
        } finally {
          loadingDirs.current.delete(node.path);
        }
      }
    }
    setExpanded(next);
  };

  const openFile = async (path: string) => {
    try {
      const res = await api.readFile(path, currentID);
      setActiveFile({ path, content: res.content ?? res.text ?? "" });
    } catch {
      // ignore
    }
  };

  const downloadWorkspaceItem = (path: string) => {
    const url = `/api/workspace/download?path=${encodeURIComponent(path)}${currentID ? `&sessionId=${encodeURIComponent(currentID)}` : ""}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const renderNode = (node: TreeNode, depth: number): ReactNode => {
    if (filter && !node.path.toLowerCase().includes(filter.toLowerCase())) {
      const hasMatch = node.children?.some((c) =>
        c.path.toLowerCase().includes(filter.toLowerCase()),
      );
      if (!hasMatch) return null;
    }
    const isOpen = expanded.has(node.path);
    const status = gitFiles.find((g) => g.path === node.path)?.status;
    return (
      <div key={node.path}>
        <div
          className={cn(
            "group flex cursor-pointer select-none items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-[#a3a3a3] transition hover:bg-[#2a2a2a] hover:text-white",
            node.isDir && "text-[#b8b8b8]",
            !node.isDir && activeFile?.path === node.path && "bg-[#303030] text-white",
          )}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => (node.isDir ? void toggleDir(node) : void openFile(node.path))}
        >
          {node.isDir ? (
            <>
              {isOpen ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
              <FolderIcon size={15} />
            </>
          ) : (
            <>
              <span className="w-3.5 shrink-0" />
              <FileIcon size={15} />
            </>
          )}
          <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{node.name}</span>
          {status && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: STATUS_COLORS[status] }}
              title={status}
            />
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              downloadWorkspaceItem(node.path);
            }}
            className="opacity-0 group-hover:opacity-100 hover:text-white transition flex-shrink-0"
            title="Download"
          >
            <DownloadIcon size={14} />
          </button>
        </div>
        {node.isDir && isOpen && node.children?.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  if (!workspaceOpen) return null;

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
        onClick={() => setWorkspaceOpen(false)}
      />

      {activeFile && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm"
            onClick={() => setActiveFile(null)}
          />
          <div className="fixed left-1/2 top-1/2 z-[65] flex h-[min(560px,85dvh)] w-[min(720px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="truncate font-mono text-sm">{toRelPath(activeFile.path)}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setActiveFile(null)}
              >
                <CloseIcon size={16} />
              </Button>
            </div>
            <pre className="flex-1 overflow-auto p-4 font-mono text-[13px] leading-relaxed text-muted-foreground whitespace-pre">
              {activeFile.content}
            </pre>
          </div>
        </>
      )}

      <aside
        className={cn(
          "z-50 flex flex-col border border-[#353535] bg-[#202020] text-[#e7e7e7] shadow-[0_8px_30px_rgba(0,0,0,0.28)] ml-[31px]",
          // Mobile: full-screen sheet from right; desktop: a dedicated floating panel.
          "fixed inset-y-0 right-0 w-full max-w-full shadow-2xl md:static md:my-2 md:mr-2 md:h-auto md:w-[260px] md:max-w-[260px] md:shrink-0 md:rounded-xl md:overflow-hidden md:shadow-[0_8px_30px_rgba(0,0,0,0.28)]",
        )}
      >
        <header className="flex h-11 shrink-0 items-center justify-between border-b border-[#303030] px-3 safe-top">
          <div className="flex gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#b4b4b4]">
            <span className="text-white">Files</span>
          </div>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-md text-[#8d8d8d] hover:bg-[#2b2b2b] hover:text-white"
              onClick={() => void refresh()}
              title="Refresh now"
              disabled={loading}
            >
              <RefreshIcon size={15} />
            </Button>
          </div>
        </header>

        <div className="border-b border-[#303030] px-2.5 py-2">
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#777]">
              <SearchIcon size={14} />
            </span>
            <Input
              className="h-8 rounded-lg border-[#333] bg-[#222] pl-8 text-[11px] text-[#ddd] placeholder:text-[#777]"
              placeholder="Filter files…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        </div>

        {gitFiles.length > 0 && (
          <div className="border-b border-border px-3 pb-2">
            <div className="mb-1 flex items-center gap-2 py-1 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              {gitFiles.length} changed {gitFiles.length === 1 ? "file" : "files"}
            </div>
            <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
              {gitFiles.slice(0, 8).map((f) => (
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-xs hover:bg-muted"
                  key={f.path}
                  onClick={() => void openFile(f.path)}
                  title={toRelPath(f.path)}
                >
                  <span
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold text-white"
                    style={{ background: STATUS_COLORS[f.status ?? ""] || "#6b7280" }}
                  >
                    {(f.status ?? "?").charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 truncate text-muted-foreground">
                    {toRelPath(f.path)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <ScrollArea className="flex-1">
          <div className="px-2 py-2 pb-8">
            {!currentID ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                Выберите или создайте чат, чтобы увидеть workspace.
              </p>
            ) : (
              <>
                {loading && tree.length === 0 && (
                  <div className="px-2 py-6 text-center">
                    <div className="mx-auto mb-2 h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
                    <p className="text-xs text-muted-foreground">Загрузка файлов…</p>
                  </div>
                )}
                {error && (
                  <div className="mx-1 mb-2 space-y-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-2 text-xs text-red-400">
                    <div>{typeof error === "string" ? error : JSON.stringify(error)}</div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => void refresh()}
                    >
                      Повторить
                    </Button>
                  </div>
                )}
                {!loading && tree.length === 0 && !error && (
                  <div className="px-2 py-4 text-xs text-muted-foreground space-y-2">
                    <p>Файлов пока нет в workspace этого чата.</p>
                    <p className="text-[11px] opacity-80">
                      Загрузите папку кнопкой выше или попросите агента создать файлы.
                    </p>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-8"
                      onClick={() => void refresh()}
                    >
                      Обновить
                    </Button>
                  </div>
                )}
                {tree.map((n) => renderNode(n, 0))}
              </>
            )}
          </div>
        </ScrollArea>
      </aside>
    </>
  );
}
