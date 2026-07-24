import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { api } from "../api/client";
import { isTmpSession } from "../lib/ids";
import { useStore } from "../store/useStore";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  DownloadIcon,
  FileIcon,
  FolderIcon,
  FolderUploadIcon,
  GitBranchIcon,
  RefreshIcon,
  SearchIcon,
} from "./icons";
import {
  DEEP_RELOAD_MAX_DEPTH,
  filterNodes as filterTreeNodes,
  SELF_IMPROVE_NODE,
  STATUS_COLORS,
  type TreeNode,
  toRelPath,
  toTree,
} from "./workspace/workspaceTreeHelpers";

function statusColor(status?: string): string {
  return STATUS_COLORS[status ?? ""] || "var(--color-muted-foreground)";
}

export default function Workspace() {
  const workspaceOpen = useStore((s) => s.workspaceOpen);
  const setWorkspaceOpen = useStore((s) => s.setWorkspaceOpen);
  const selfImproveEnabled = useStore((s) => s.selfImproveEnabled);
  const currentID = useStore((s) => s.currentID);
  const selfImproveSessionId = useStore((s) => s.selfImproveSessionId);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const expandedRef = useRef<Set<string>>(expanded);
  const [activeFile, setActiveFile] = useState<{
    path: string;
    content: string;
  } | null>(null);
  const [filter, setFilter] = useState("");
  const [gitFiles, setGitFiles] = useState<{ path: string; status?: string }[]>(
    [],
  );
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
  const showSynthetic =
    selfImproveEnabled && currentID !== selfImproveSessionId;
  const withSelfImproveRoot = useCallback(
    (nodes: TreeNode[]): TreeNode[] =>
      showSynthetic
        ? [SELF_IMPROVE_NODE, ...nodes.filter((n) => n.path !== "opencode-ui")]
        : nodes,
    [showSynthetic],
  );

  const sessions = useStore((s) => s.sessions);
  const mySessionIds = useMemo(
    () => new Set(sessions.map((s) => s.id)),
    [sessions],
  );
  const filterNodes = useCallback(
    (nodes: { path: string; type?: string; isDirectory?: boolean }[]) =>
      filterTreeNodes(nodes, { mySessionIds, selfImproveEnabled }),
    [mySessionIds, selfImproveEnabled],
  );

  const loadDir = useCallback(
    async (path: string) => {
      if (!currentID || isTmpSession(currentID)) return [];
      try {
        const nodes = await api.listDir(path, currentID);
        let tree = Array.isArray(nodes)
          ? toTree(
              filterNodes(nodes) as {
                path: string;
                type?: string;
                isDirectory?: boolean;
              }[],
            )
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
  // Старый обход N+1 запросами /file — теперь только fallback на случай,
  // если сервер ещё без эндпоинта /workspace/tree (старый деплой).
  const loadTreeDeepViaListDir = useCallback(async (): Promise<TreeNode[]> => {
    const rootNodes = await loadDir(".");
    const expandedPaths = expandedRef.current;
    const fill = async (
      nodes: TreeNode[],
      depth: number,
    ): Promise<TreeNode[]> =>
      Promise.all(
        nodes.map(async (n) => {
          if (
            !n.isDir ||
            !expandedPaths.has(n.path) ||
            depth >= DEEP_RELOAD_MAX_DEPTH
          )
            return n;
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

  // Релиз 3: один рекурсивный запрос к серверу вместо N+1 listDir по
  // раскрытым папкам. Все папки приходят с полным содержимым — помечаем
  // их loaded, чтобы toggleDir не делал лишний догружающий запрос.
  // Синтетическая opencode-ui-нода живёт на allowlist-прокси и в обход
  // не попадает — она остаётся loaded:false и грузится при раскрытии.
  const loadTreeDeep = useCallback(async (): Promise<TreeNode[]> => {
    if (!currentID || isTmpSession(currentID)) return [];
    try {
      const nodes = await api.listTree(currentID);
      if (!Array.isArray(nodes)) throw new Error("bad tree response");
      const markLoaded = (ns: TreeNode[]): TreeNode[] =>
        ns.map((n) =>
          n.isDir
            ? { ...n, loaded: true, children: markLoaded(n.children ?? []) }
            : n,
        );
      const tree = markLoaded(
        toTree(
          filterNodes(nodes) as {
            path: string;
            type?: string;
            isDirectory?: boolean;
          }[],
        ),
      );
      return withSelfImproveRoot(tree);
    } catch {
      return loadTreeDeepViaListDir();
    }
  }, [currentID, filterNodes, withSelfImproveRoot, loadTreeDeepViaListDir]);

  const refresh = useCallback(async () => {
    if (!currentID || isTmpSession(currentID)) {
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
    if (!currentID || isTmpSession(currentID)) return;
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
    if (!currentID || isTmpSession(currentID)) {
      setGitFiles([]);
      return;
    }
    try {
      const files = await api.gitStatus(currentID);
      const list = Array.isArray(files)
        ? (files as { path: string; status?: string }[])
        : [];
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
        if (!file) continue;
        const relPath =
          (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
          file.name;
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
        refresh().catch(() => {});
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
    if (!workspaceOpen || !currentID || isTmpSession(currentID)) return;
    refresh().catch(() => {});
    loadGit().catch(() => {});
    const poll = setInterval(() => {
      // Релиз 3: вкладка неактивна — не гоняем фоновые запросы к ФС.
      if (document.hidden) return;
      autoRefresh().catch(() => {});
      loadGit().catch(() => {});
    }, 8000);
    const onVisibility = () => {
      // Вернулись на вкладку — сразу освежаем, не дожидаясь тика таймера.
      if (!document.hidden) {
        autoRefresh().catch(() => {});
        loadGit().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisibility);
    };
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
            "group flex cursor-pointer select-none items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-accent hover:text-foreground",
            node.isDir && "text-muted-foreground",
            !node.isDir &&
              activeFile?.path === node.path &&
              "bg-accent text-white",
          )}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() =>
            node.isDir
              ? toggleDir(node).catch(() => {})
              : openFile(node.path).catch(() => {})
          }
        >
          {node.isDir ? (
            <>
              {isOpen ? (
                <ChevronDownIcon size={14} />
              ) : (
                <ChevronRightIcon size={14} />
              )}
              <FolderIcon size={15} />
            </>
          ) : (
            <>
              <span className="w-3.5 shrink-0" />
              <FileIcon size={15} />
            </>
          )}
          <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
            {node.name}
          </span>
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
            className="opacity-0 group-hover:opacity-100 hover:text-foreground transition flex-shrink-0"
            title="Скачать файл"
            aria-label="Скачать файл"
          >
            <DownloadIcon size={14} />
          </button>
        </div>
        {node.isDir &&
          isOpen &&
          node.children?.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  if (!workspaceOpen) return null;

  return (
    <>
      {activeFile && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm"
            onClick={() => setActiveFile(null)}
          />
          <div className="fixed left-1/2 top-1/2 z-[65] flex h-[min(560px,85dvh)] w-[min(720px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg">
            <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
              <span className="truncate font-mono text-sm">
                {toRelPath(activeFile.path)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => setActiveFile(null)}
              >
                <CloseIcon size={16} />
              </Button>
            </div>
            <ScrollArea className="flex-1 min-h-0 w-full">
              <pre className="p-4 font-mono text-[13px] leading-relaxed text-muted-foreground whitespace-pre">
                {activeFile.content}
              </pre>
            </ScrollArea>
          </div>
        </>
      )}

      <aside
        className={cn(
          "z-50 flex flex-col border border-border bg-background text-foreground min-h-0",
          // Mobile: fills the sliding right sidebar drawer perfectly without overflowing.
          // Desktop: fixed maximum size window inside the right sidebar, height strictly clamped so ScrollArea scrolls.
          "w-full h-full max-h-full shadow-lg md:static md:my-2 md:mx-2 md:h-[calc(100%-1rem)] md:max-h-[calc(100%-1rem)] md:w-[calc(100%-1rem)] md:max-w-[calc(100%-1rem)] md:shrink-0 md:rounded-xl md:overflow-hidden md:shadow-none md:border md:border-border",
        )}
      >
        <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3 safe-top">
          <div className="flex gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <span className="text-white">Files</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => {
                refresh().catch(() => {});
              }}
              title="Обновить"
              aria-label="Обновить"
              disabled={loading}
            >
              <RefreshIcon size={15} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
              onClick={() => setWorkspaceOpen(false)}
              title="Закрыть файлы проекта"
              aria-label="Закрыть файлы проекта"
            >
              <CloseIcon size={15} />
            </Button>
          </div>
        </header>

        <div className="border-b border-border px-2.5 py-2 shrink-0">
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
              <SearchIcon size={14} />
            </span>
            <Input
              className="h-8 rounded-lg border-border bg-card pl-8 text-[11px] text-foreground placeholder:text-muted-foreground"
              placeholder="Фильтр файлов…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        </div>

        {gitFiles.length > 0 && (
          <div className="border-b border-border px-3 pb-2 shrink-0">
            <div className="mb-1 flex items-center gap-2 py-1 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              {gitFiles.length} changed{" "}
              {gitFiles.length === 1 ? "file" : "files"}
            </div>
            <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
              {gitFiles.slice(0, 8).map((f) => (
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-xs hover:bg-muted"
                  key={f.path}
                  onClick={() => openFile(f.path).catch(() => {})}
                  title={toRelPath(f.path)}
                >
                  <span
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold text-white"
                    style={{
                      background: statusColor(f.status),
                    }}
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

        <ScrollArea className="flex-1 min-h-0 w-full">
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
                    <p className="text-xs text-muted-foreground">
                      Загрузка файлов…
                    </p>
                  </div>
                )}
                {error && (
                  <div className="mx-1 mb-2 space-y-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-2 text-xs text-red-400">
                    <div>
                      {typeof error === "string"
                        ? error
                        : JSON.stringify(error)}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => {
                        refresh().catch(() => {});
                      }}
                    >
                      Повторить
                    </Button>
                  </div>
                )}
                {!loading && tree.length === 0 && !error && (
                  <div className="px-2 py-4 text-xs text-muted-foreground space-y-2">
                    <p>Файлов пока нет в workspace этого чата.</p>
                    <p className="text-[11px] opacity-80">
                      Загрузите папку кнопкой выше или попросите агента создать
                      файлы.
                    </p>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8"
                      onClick={() => {
                        refresh().catch(() => {});
                      }}
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
