import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "../store/useStore";
import { api } from "../api/client";
import {
  ChevronRightIcon,
  ChevronDownIcon,
  FileIcon,
  FolderIcon,
  CloseIcon,
  SearchIcon,
  GitBranchIcon,
  RefreshIcon,
  FolderUploadIcon,
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
      let child = cur.children!.find((c) => c.name === parts[i]);
      if (!child) {
        child = { name: parts[i], path: acc, isDir, children: isDir ? [] : undefined, loaded: false };
        cur.children!.push(child);
      }
      if (isDir) cur = child;
    }
  }
  const sort = (nodes: TreeNode[]): TreeNode[] => {
    nodes.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
    nodes.forEach((n) => n.children && sort(n.children));
    return nodes;
  };
  return sort(root.children ?? []);
}
// Strip the per-session workspace root so the UI shows a clean relative path
// (e.g. "src/App.tsx" instead of "/app/workspace/sessions/ses_xxx/workspace/src/App.tsx").
function toRelPath(p: string): string {
  if (!p) return p;
  const m = p.match(/^\/app\/workspace\/sessions\/[^/]+\/workspace(\/.*)?$/);
  if (m) return m[1] ? m[1].replace(/^\//, "") : ".";
  if (p.startsWith("/app/workspace/")) return p.slice("/app/workspace/".length);
  return p;
}


const STATUS_COLORS: Record<string, string> = {
  modified: "var(--yellow)",
  added: "var(--green)",
  untracked: "var(--blue)",
  deleted: "var(--red)",
  renamed: "var(--blue)",
};

export default function Workspace() {
  const workspaceOpen = useStore((s) => s.workspaceOpen);
  const setWorkspaceOpen = useStore((s) => s.setWorkspaceOpen);
  const selfImproveEnabled = useStore((s) => s.selfImproveEnabled);
  const currentID = useStore((s) => s.currentID);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const expandedRef = useRef<Set<string>>(expanded);
  const [activeFile, setActiveFile] = useState<{ path: string; content: string } | null>(null);
  const [filter, setFilter] = useState("");
  const [gitFiles, setGitFiles] = useState<{ path: string; status?: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Folder upload state
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const treeRef = useRef<TreeNode[]>([]);
  // Create folder input imperatively so webkitdirectory works in all browsers
  useEffect(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    (input as any).webkitdirectory = true;
    (input as any).directory = true;
    (input as any).mozdirectory = true;
    input.style.display = "none";
    input.addEventListener("change", handleFolderUpload);
    document.body.appendChild(input);
    folderInputRef.current = input;
    return () => {
      input.removeEventListener("change", handleFolderUpload);
      input.remove();
      folderInputRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track directories currently being loaded to prevent duplicate fetches.
  const loadingDirs = useRef<Set<string>>(new Set());

  const filterNodes = (nodes: any[]) => {
    if (!Array.isArray(nodes)) return [];
    const mySessionIds = new Set(useStore.getState().sessions.map((s) => s.id));
    return nodes.filter((n) => {
      const parts = (n.path || "").split("/");
      const p = parts[0];
      if (p === ".config_opencode" || p === ".opencode_data" || p === ".local" || p === ".config" || p === ".cache" || p === "node_modules" || p === ".git" || p === ".users.json" || p === ".sessions.json" || p === ".session_owners.json" || p === ".admin_password" || p === ".self_improve_mode" || (n.path || "").endsWith(".tsbuildinfo")) {
        return false;
      }
      if (!selfImproveEnabled && p === "opencode-ui") {
        return false;
      }
      if ((p === "sessions" || p === "uploads" || p === "temp") && parts.length > 1) {
        const sid = parts[1];
        if (sid && sid.startsWith("ses_") && !mySessionIds.has(sid)) {
          return false; // Hide other users' session folders!
        }
      }
      return true;
    });
  };

  const loadDir = async (path: string) => {
    if (!currentID) return [];
    try {
      const nodes = await api.listDir(path, currentID);
      return Array.isArray(nodes)
        ? toTree(filterNodes(nodes) as { path: string; type?: string; isDirectory?: boolean }[])
        : [];
    } catch {
      return [];
    }
  };

  // Keep refs in sync on every render so autoRefresh never uses stale data
  treeRef.current = tree;
  expandedRef.current = expanded;

  useEffect(() => {
    if (!workspaceOpen) return;
    // Initial load on open.
    if (tree.length === 0) refresh();
    loadGit();
    // Auto-refresh every 3s — silent. Only re-reads root + expanded dirs.
    const poll = setInterval(() => {
      autoRefresh();
      loadGit();
    }, 3000);
    return () => clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceOpen]);

  useEffect(() => {
    if (workspaceOpen) {
      refresh();
      loadGit();
    }
  }, [selfImproveEnabled]);

  // Reset the file tree when switching chats so the previous chat's
  // workspace doesn't briefly appear in the panel (avoids the nested
  // "matryoshka" of session folders from the instance's default dir).
  useEffect(() => {
    setTree([]);
    setExpanded(new Set([""]));
    if (workspaceOpen) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentID]);

  const refresh = async () => {
    setLoading(true);
    const t = await loadDir(".");
    setTree(t);
    setLoading(false);
  };

  // Silent refresh: only refresh children of expanded directories.
  // Uses ref to avoid stale closure over 'tree' and 'expanded'.
  const autoRefresh = async () => {
    const t = await loadDir(".");
    const curExpanded = expandedRef.current;
    const curTree = treeRef.current;

    const merge = (fresh: TreeNode[], old: TreeNode[]): TreeNode[] =>
      fresh.map((fn) => {
        const oldNode = old.find((o) => o.path === fn.path);
        // Only keep loaded children for expanded dirs; otherwise preserve old children
        if (fn.isDir && oldNode) {
          if (curExpanded.has(fn.path)) {
            // Keep old children (they were loaded on demand), mark as loaded
            return { ...fn, children: oldNode.children ?? [], loaded: oldNode.loaded ?? true };
          }
          // Not expanded: keep children if they were loaded, otherwise empty
          return { ...fn, children: oldNode.children ?? [], loaded: oldNode.loaded ?? false };
        }
        return fn;
      });

    const merged = curTree.length === 0 ? t : merge(t, curTree);
    setTree(merged);
  };

  const loadGit = async () => {
    if (!currentID) { setGitFiles([]); return; }
    try {
      const files = await api.gitStatus(currentID);
      const list = Array.isArray(files) ? (files as { path: string; status?: string }[]) : [];
      setGitFiles(filterNodes(list));
    } catch {
      setGitFiles([]);
    }
  };

  const toggleDir = async (node: TreeNode) => {
    const next = new Set(expanded);
    expandedRef.current = next;
    if (next.has(node.path)) {
      next.delete(node.path);
    } else {
      next.add(node.path);
      // Guard against double-load on rapid clicks.
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
          setTree(update(tree));
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
      // ignore — viewer just doesn't open
    }
  };

  const handleFolderUpload = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const fileList = input.files;
    if (!fileList || fileList.length === 0) return;
    
    const files: { path: string; file: File }[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const relPath = (file as any).webkitRelativePath || file.name;
      files.push({ path: relPath, file });
    }
    
    setUploading(true);
    setUploadTotal(files.length);
    setUploadProgress(0);
    setUploadMsg(`Uploading ${files.length} files…`);
    
    try {
      // Split into batches of 20 for progress reporting
      const BATCH = 20;
      for (let i = 0; i < files.length; i += BATCH) {
        const batch = files.slice(i, i + BATCH);
        await api.uploadFolder(batch);
        setUploadProgress(Math.min(i + BATCH, files.length));
      }
      setUploadMsg(`Done! ${files.length} file(s) uploaded.`);
      refresh(); // Refresh the tree
      setTimeout(() => setUploadMsg(null), 3000);
    } catch (err: any) {
      setUploadMsg(`Error: ${err.message}`);
      setTimeout(() => setUploadMsg(null), 5000);
    } finally {
      setUploading(false);
      // Reset the input so the same folder can be re-uploaded
      input.value = "";
    }
  };

  const renderNode = (node: TreeNode, depth: number): ReactNode => {
    if (filter && !node.path.toLowerCase().includes(filter.toLowerCase())) {
      const hasMatch = node.children?.some((c) => c.path.toLowerCase().includes(filter.toLowerCase()));
      if (!hasMatch) return null;
    }
    const isOpen = expanded.has(node.path);
    const status = gitFiles.find((g) => g.path === node.path)?.status;
    return (
      <div key={node.path}>
        <div
          className={`tree-row ${!node.isDir && activeFile?.path === node.path ? "active" : ""}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => (node.isDir ? toggleDir(node) : openFile(node.path))}
        >
          {node.isDir ? (
            <>
              {isOpen ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
              <FolderIcon size={15} />
            </>
          ) : (
            <>
              <span className="tree-spacer" />
              <FileIcon size={15} />
            </>
          )}
          <span className="tree-name">{node.name}</span>
          {status && <span className="git-status-dot" style={{ background: STATUS_COLORS[status] }} title={status} />}
        </div>
        {node.isDir && isOpen && node.children?.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  if (!workspaceOpen) return null;

  return (
    <>
      {activeFile && (
        <>
          <div className="ws-viewer-backdrop" onClick={() => setActiveFile(null)} />
          <div className="ws-viewer">
            <div className="ws-viewer-head">
              <span className="ws-viewer-path">{toRelPath(activeFile.path)}</span>
              <button className="icon-btn" onClick={() => setActiveFile(null)}>
                <CloseIcon size={16} />
              </button>
            </div>
            <pre className="ws-viewer-content">{activeFile.content}</pre>
          </div>
        </>
      )}
      <aside className="workspace open">
        <header className="ws-head">
          <span className="ws-title">
            <GitBranchIcon size={15} /> Workspace
            <span className="live-dot" title="Auto-refreshing every 3s" />
          </span>
          <div className="ws-head-actions">
            <button className="icon-btn sm" onClick={refresh} title="Refresh now">
              <RefreshIcon size={15} />
            </button>
            <button
              className="icon-btn sm"
              onClick={() => setWorkspaceOpen(false)}
              title="Close"
            >
              <CloseIcon size={16} />
            </button>
          </div>
        </header>

        <div className="ws-upload-section">
          <button
            className="ws-upload-btn"
            disabled={uploading}
            onClick={() => folderInputRef.current?.click()}
            title="Upload entire folder with subfolders"
          >
            <FolderUploadIcon size={15} />
            {uploading ? `Uploading… ${uploadProgress}/${uploadTotal}` : "Upload folder"}
          </button>
          {uploadMsg && (
            <div className="ws-upload-progress">
              <div className="ws-upload-bar">
                <div
                  className="ws-upload-bar-fill"
                  style={{ width: uploadTotal > 0 ? `${(uploadProgress / uploadTotal) * 100}%` : "0%" }}
                />
              </div>
              <span>{uploadMsg}</span>
            </div>
          )}
        </div>

        <div className="ws-search">
          <SearchIcon size={14} />
          <input
            placeholder="Filter files…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        {gitFiles.length > 0 && (
          <div className="ws-git">
            <div className="ws-git-head">
              <span className="dot git-dot" />
              {gitFiles.length} changed {gitFiles.length === 1 ? "file" : "files"}
            </div>
            <div className="ws-git-list">
              {gitFiles.slice(0, 8).map((f) => (
                <div
                  className="ws-git-item"
                  key={f.path}
                  onClick={() => openFile(f.path)}
                  title={toRelPath(f.path)}
                >
                  <span
                    className="git-tag"
                    style={{ background: STATUS_COLORS[f.status ?? ""] }}
                  >
                    {(f.status ?? "?").charAt(0).toUpperCase()}
                  </span>
                  <span className="ws-git-path">{toRelPath(f.path)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="ws-tree">
          {!currentID ? (
            <p className="muted small ws-loading">Select or create a chat to see its workspace.</p>
          ) : (
            <>
              {loading && tree.length === 0 && <p className="muted small ws-loading">Loading…</p>}
              {error && <div className="error-banner small">{error}</div>}
              {!loading && tree.length === 0 && !error && (
                <p className="muted small ws-loading">No files found.</p>
              )}
              {tree.map((n) => renderNode(n, 0))}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
