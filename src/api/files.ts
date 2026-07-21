// File attachment utilities — convert browser File objects to API parts.

export interface ProcessedFile {
  name: string;
  size: number;
  mime: string;
  ext: string;
  kind: "image" | "pdf" | "text" | "zip" | "binary";
  // For the API message:
  part?: { type: "file"; mime: string; url: string; filename?: string };
  // For text files: inline content as text part:
  textPart?: { type: "text"; text: string };
  // Raw data URL for preview:
  dataUrl?: string;
  // Server-assigned path after upload (set by api.uploadFile):
  uploadedPath?: string;
  // Absolute file path as seen by the session's opencode instance
  // (runner: /session/workspace/uploads/..., legacy: <WORKDIR>/sessions/...):
  agentPath?: string;
  // For zip archives: number of entries inside (set by api.uploadFile):
  entryCount?: number;
}

const TEXT_EXTS = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "js",
  "jsx",
  "ts",
  "tsx",
  "css",
  "scss",
  "html",
  "htm",
  "xml",
  "yaml",
  "yml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "c",
  "cpp",
  "h",
  "hpp",
  "cs",
  "php",
  "swift",
  "sh",
  "bash",
  "zsh",
  "sql",
  "graphql",
  "gql",
  "vue",
  "svelte",
  "astro",
  "env",
  "gitignore",
  "dockerfile",
  "csv",
  "tsv",
  "log",
]);

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"]);
const MAX_TEXT_SIZE = 200_000; // 200KB — don't inline huge text files

export function fileKind(name: string): ProcessedFile["kind"] {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (ext === "zip") return "zip";
  if (TEXT_EXTS.has(ext)) return "text";
  return "binary";
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result is "data:<mime>;base64,<data>" — extract just the data URL
      resolve(result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function processFile(file: File): Promise<ProcessedFile> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const kind = fileKind(file.name);
  const mime = file.type || mimeFromExt(ext);
  const dataUrl = await fileToBase64(file);

  const result: ProcessedFile = {
    name: file.name,
    size: file.size,
    mime,
    ext,
    kind,
    dataUrl,
    part: {
      type: "file",
      mime,
      url: dataUrl,
      filename: file.name,
    },
  };

  return result;
}

export function mimeFromExt(ext: string): string {
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    pdf: "application/pdf",
    zip: "application/zip",
    txt: "text/plain",
    md: "text/markdown",
    json: "application/json",
    js: "text/javascript",
    ts: "text/typescript",
    html: "text/html",
    css: "text/css",
    csv: "text/csv",
  };
  return map[ext] ?? "application/octet-stream";
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const ACCEPTED_EXTENSIONS =
  ".jpg,.jpeg,.png,.gif,.webp,.bmp,.svg,.pdf,.zip,.txt,.md,.json,.js,.jsx,.ts,.tsx,.css,.scss,.html,.xml,.yaml,.yml,.toml,.py,.rb,.go,.rs,.java,.c,.cpp,.h,.cs,.php,.sh,.sql,.csv,.log,.env";
