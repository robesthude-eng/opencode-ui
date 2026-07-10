import type {
  Message,
  SessionInfo,
  FileNode,
  TrackedFile,
  ProvidersResponse,
} from "./types";

export interface ClientConfig {
  baseUrl: string;
  username?: string;
}

let config: ClientConfig = { baseUrl: "/api" };

export function configure(cfg: Partial<ClientConfig>) {
  config = { ...config, ...cfg };
}

export function getConfig() {
  return config;
}

/** Same-origin JSON headers. Auth is HttpOnly cookie (credentials: include). */
function headers(): Record<string, string> {
  return { "Content-Type": "application/json" };
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      credentials: "include",
      signal: controller.signal,
      headers: { ...headers(), ...(init?.headers as Record<string, string> | undefined) },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${res.status} ${res.statusText} ${body}`.trim());
    }
    if (res.status === 204) return undefined as T;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) {
      const preview = (await res.clone().text().catch(() => "")).slice(0, 80);
      throw new Error(`Request to ${path} → non-JSON (${ct || "no ct"}): ${preview}`);
    }
    return res.json() as Promise<T>;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Request to ${path} timed out after 30s`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export interface PromptModel {
  providerID: string;
  modelID: string;
}

export const api = {
  health: () => req<{ status: string }>(`/global/health`),

  listSessions: () => req<SessionInfo[]>(`/session`),
  createSession: (title?: string) =>
    req<SessionInfo>(`/session`, {
      method: "POST",
      body: JSON.stringify(title ? { title } : {}),
    }),
  getSession: (id: string) => req<SessionInfo>(`/session/${id}`),
  deleteSession: (id: string) => req<void>(`/session/${id}`, { method: "DELETE" }),
  abortSession: (id: string) => req<void>(`/session/${id}/abort`, { method: "POST" }),
  listMessages: (id: string) => req<Message[]>(`/session/${id}/message`),

  prompt: (id: string, text: string, model?: PromptModel) =>
    req<Message>(`/session/${id}/message`, {
      method: "POST",
      body: JSON.stringify({
        parts: [{ type: "text", text }],
        ...(model ? { model } : {}),
      }),
    }),

  promptWithParts: (
    id: string,
    parts: Record<string, unknown>[],
    model?: PromptModel,
    systemInstruction?: string,
  ) =>
    req<Message>(`/session/${id}/message`, {
      method: "POST",
      body: JSON.stringify({
        parts,
        ...(model ? { model } : {}),
        ...(systemInstruction ? { system: systemInstruction } : {}),
      }),
    }),

  respondPermission: (id: string, permissionId: string, response: "allow" | "deny") =>
    req<void>(`/session/${id}/permissions/${permissionId}`, {
      method: "POST",
      body: JSON.stringify({ response }),
    }),

  listDir: (path = ".", sessionId?: string | null) =>
    req<FileNode[]>(
      `/file?path=${encodeURIComponent(path)}${sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : ""}`,
    ),
  readFile: (path: string, sessionId?: string | null) =>
    req<{ content?: string; text?: string; path: string }>(
      `/file/content?path=${encodeURIComponent(path)}${sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : ""}`,
    ),
  gitStatus: (sessionId?: string | null) =>
    req<TrackedFile[]>(
      `/file/status${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`,
    ),

  uploadFolder: async (files: { path: string; file: File }[]) => {
    const form = new FormData();
    for (const { path, file } of files) {
      form.append(path, file);
    }
    const res = await fetch(`${config.baseUrl}/workspace/upload-folder`, {
      method: "POST",
      credentials: "include",
      body: form,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${res.status} ${res.statusText} ${body}`.trim());
    }
    return res.json() as Promise<{ ok: boolean; written: number; errors?: string[] }>;
  },

  uploadFile: (
    file: File,
    onProgress?: (pct: number) => void,
    sessionId?: string | null,
  ): Promise<{ ok: boolean; path: string; size: number; entryCount?: number | null }> =>
    new Promise((resolve, reject) => {
      const base = `${config.baseUrl}/workspace/upload`;
      const url = sessionId ? `${base}?sessionId=${encodeURIComponent(sessionId)}` : base;
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            reject(new Error("Invalid server response"));
          }
        } else {
          try {
            reject(new Error(JSON.parse(xhr.responseText)?.error || xhr.statusText));
          } catch {
            reject(new Error(`${xhr.status} ${xhr.statusText}`));
          }
        }
      };
      xhr.onerror = () => reject(new Error("Upload failed — network error"));
      const form = new FormData();
      form.append("file", file, file.name);
      xhr.send(form);
    }),

  listProviders: () => req<ProvidersResponse>(`/config/providers`),
  listConnected: () =>
    req<{ connected?: string[]; all?: unknown[]; default?: Record<string, string> }>(
      `/provider`,
    ),

  setAuth: (providerId: string, key: string) =>
    req<boolean>(`/auth/${providerId}`, {
      method: "PUT",
      body: JSON.stringify({ type: "api", key }),
    }),
  removeAuth: (providerId: string) =>
    req<void>(`/auth/${providerId}`, { method: "DELETE" }),

  saveCustomKey: (providerId: string, key: string) =>
    req<{ status: string }>(`/auth/custom`, {
      method: "POST",
      body: JSON.stringify({ providerId, key }),
    }),
  removeCustomKey: (providerId: string) =>
    req<{ status: string }>(`/auth/custom`, {
      method: "DELETE",
      body: JSON.stringify({ providerId }),
    }),
  listCustomKeys: () => req<string[]>(`/auth/custom`),
};

/**
 * SSE URL — cookie is sent automatically same-origin by EventSource.
 */
export function eventUrl(_sessionId?: string | null): string {
  return `${config.baseUrl}/event`;
}
