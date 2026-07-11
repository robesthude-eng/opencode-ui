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
  const treeRef = useRef<TreeNode[]>([]);
  const loadingDirs = useRef<Set<string>>(new Set());
  const loadGen = useRef(0);

  // Synthetic root node that surfaces the live project source (opencode-ui) in the
  // Workspace. The server resolves its contents to /app/workspace/opencode-ui via a
  // strict allowlist (see server/index.mjs handleSelfImproveFileProxy).
  const SELF_IMPROVE_NODE: TreeNode = {
    name: "opencode-ui",
    path: "opencode-ui",
    isDir: true,
    children: [],
    loaded: false,
  };
  // Show the synthetic "opencode-ui" node for any session EXCEPT the dedicated
  // Self-Improvement chat — that chat's agent already operates directly on the
  // project source, so its own root IS the project (no duplicate node needed).
  const showSynthetic = selfImproveEnabled && currentID !== selfImproveSessionId;
  const withSelfImproveRoot = useCallback(
    (nodes: TreeNode[]): TreeNode[] =>
      showSynthetic ? [SELF_IMPROVE_NODE, ...nodes] : nodes,
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
        return Array.isArray(nodes)
          ? toTree(filterNodes(nodes) as { path: string; type?: string; isDirectory?: boolean }[])
          : [];
      } catch (e: unknown) {
        throw e instanceof Error ? e : new Error(String(e));
      }
    },
    [currentID, filterNodes],
  );

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
      const t = await loadDir(".");
      if (gen !== loadGen.current) return;
      setTree(withSelfImproveRoot(t));
    } catch (e: unknown) {
      if (gen !== loadGen.current) return;
      setError((e as Error)?.message || "Не удалось загрузить файлы");
      setTree(withSelfImproveRoot([]));
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, [currentID, loadDir, withSelfImproveRoot]);

  const autoRefresh = useCallback(async () => {
    if (!currentID || currentID.startsWith("tmp_")) return;
    try {
      const t = await loadDir(".");
      const curExpanded = expandedRef.current;
      const curTree = treeRef.current;
      const merge = (fresh: TreeNode[], old: TreeNode[]): TreeNode[] =>
        fresh.map((fn) => {
          const oldNode = old.find((o) => o.path === fn.path);
          if (fn.isDir && oldNode) {
            if (curExpanded.has(fn.path)) {
              return {
                ...fn,
                children: oldNode.children ?? [],
                loaded: oldNode.loaded ?? true,
              };
            }
            return {
              ...fn,
              children: oldNode.children ?? [],
              loaded: oldNode.loaded ?? false,
            };
          }
          return fn;
        });
      const freshRoot = withSelfImproveRoot(t);
      setTree(curTree.length === 0 ? freshRoot : merge(freshRoot, curTree));
    } catch {
      // silent poll errors
    }
  }, [currentID, loadDir, withSelfImproveRoot]);

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
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
    input.setAttribute('mozdirectory', '');
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
        const relPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
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

  treeRef.current = tree;
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
  }, [workspaceOpen, currentID, selfImproveEnabled, refresh, loadGit, autoRefresh]);

  useEffect(() => {
    setExpanded(new Set([""]));
    setActiveFile(null);
    setTree([]);
  }, [selfImproveEnabled, currentID]);

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
            "flex cursor-pointer select-none items-center gap-1.5 rounded-md px-1.5 py-1.5 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground",
            !node.isDir && activeFile?.path === node.path && "bg-muted text-foreground",
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
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          {status && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: STATUS_COLORS[status] }}
              title={status}
            />
          )}
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
          "z-50 flex flex-col border-border bg-card",
          // Mobile: full-screen sheet from right
          "fixed inset-y-0 right-0 w-full max-w-full border-l shadow-2xl md:static md:h-dvh md:w-[300px] md:max-w-[300px] md:shrink-0 md:shadow-none",
        )}
      >
        <header className="flex items-center justify-between border-b border-border px-3 py-3 safe-top">
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <GitBranchIcon size={15} />
            Workspace
            <span className="live-dot" title="Auto-refresh" />
          </span>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => void refresh()}
              title="Refresh now"
              disabled={loading}
            >
              <RefreshIcon size={15} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setWorkspaceOpen(false)}
              title="Close"
            >
              <CloseIcon size={16} />
            </Button>
          </div>
        </header>

        <div className="border-b border-border px-2 py-2">
          <Button
            variant="outline"
            className="h-9 w-full justify-start gap-2 border-dashed text-xs"
            disabled={uploading || !currentID}
            onClick={() => folderInputRef.current?.click()}
            title="Upload entire folder with subfolders"
          >
            <FolderUploadIcon size={15} />
            {uploading ? `Uploading… ${uploadProgress}/${uploadTotal}` : "Upload folder"}
          </Button>
          {uploadMsg && (
            <div className="mt-2 space-y-1.5 text-[11px] text-muted-foreground">
              <div className="h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{
                    width: uploadTotal > 0 ? `${(uploadProgress / uploadTotal) * 100}%` : "0%",
                  }}
                />
              </div>
              <span>{uploadMsg}</span>
            </div>
          )}
        </div>

        <div className="px-2 py-2">
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
              <SearchIcon size={14} />
            </span>
            <Input
              className="h-9 pl-8 text-xs"
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
                    <div>{error}</div>
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
