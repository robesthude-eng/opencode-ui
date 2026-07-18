import type {
  FileNode,
  Message,
  ProvidersResponse,
  SessionInfo,
  TrackedFile,
} from "./types";

export interface ClientConfig {
  baseUrl: string;
  username?: string;
}

let config: ClientConfig = { baseUrl: "/api" };

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
// Agent prompts are long-lived requests. Their completion is governed by the
// send watchdog and SSE/HTTP reconciliation, not a second fetch timeout.
const PROMPT_REQUEST_TIMEOUT_MS: number | null = null;

export function configure(cfg: Partial<ClientConfig>) {
  config = { ...config, ...cfg };
}

export function getConfig() {
  return config;
}

/** Same-origin JSON headers. Auth is HttpOnly cookie (credentials: include). */
function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  // Double Submit Cookie: значение не-HttpOnly куки opencode_csrf дублируется
  // в заголовке — сервер сверяет их, когда Origin/Referer вырезаны фаерволом.
  const csrf = document.cookie.match(/(?:^|;\s*)opencode_csrf=([^;]+)/)?.[1];
  if (csrf) h["x-csrf-token"] = decodeURIComponent(csrf);
  return h;
}

async function req<T>(
  path: string,
  init?: RequestInit,
  timeoutMs: number | null = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<T> {
  // guard: обрываем запрос, если sessionID в пути уже в blacklist
  const sidMatch = path.match(/\/session\/(ses_[A-Za-z0-9]+)/);
  if (sidMatch && __deadSessions.has(sidMatch[1])) {
    throw new SessionGoneError(sidMatch[1], "session in local dead-list");
  }

  const controller = new AbortController();
  const timeout =
    timeoutMs === null ? null : setTimeout(() => controller.abort(), timeoutMs);
  // Релиз 4: внешний сигнал (централизованная отмена по сессии) комбинируется
  // с внутренним таймаут-контроллером.
  const externalSignal = init?.signal ?? null;
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", onExternalAbort);
  }
  try {
    const res = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      credentials: "include",
      signal: controller.signal,
      headers: {
        ...headers(),
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // 410 Gone → сессия убита на бэке. Помечаем в blacklist и бросаем
      // типизированную ошибку — sessionsSlice.select() / messagesSlice.send()
      // сами почистят стор, создадут новую сессию и повторят prompt.
      if (res.status === 410) {
        let sid = sidMatch?.[1];
        if (!sid) {
          try {
            const j = JSON.parse(body);
            if (typeof j.sessionId === "string") sid = j.sessionId;
          } catch {}
        }
        if (sid) _markSessionDead(sid);
        throw new SessionGoneError(sid ?? "unknown", body || "session_gone");
      }
      throw new Error(`${res.status} ${res.statusText} ${body}`.trim());
    }
    if (res.status === 204) return undefined as T;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) {
      const preview = (
        await res
          .clone()
          .text()
          .catch(() => "")
      ).slice(0, 80);
      throw new Error(
        `Request to ${path} → non-JSON (${ct || "no ct"}): ${preview}`,
      );
    }
    return res.json() as Promise<T>;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      // Отмена внешним сигналом (кнопка «Стоп») — пробрасываем AbortError
      // как есть, это не таймаут.
      if (externalSignal?.aborted) throw err;
      const seconds =
        timeoutMs === null
          ? "the request limit"
          : `${Math.round(timeoutMs / 1000)}s`;
      throw new Error(`Request to ${path} timed out after ${seconds}`);
    }
    throw err;
  } finally {
    if (timeout) clearTimeout(timeout);
    if (externalSignal)
      externalSignal.removeEventListener("abort", onExternalAbort);
  }
}

export interface PromptModel {
  providerID: string;
  modelID: string;
}

// UX-fix: локальный чёрный список sessionID, для которых сервер уже вернул 410.
// Дальнейшие запросы к таким ID мы обрываем на клиенте, не тратя сеть.
const __deadSessions = new Set<string>();
function _markSessionDead(sid: string) {
  if (sid) __deadSessions.add(sid);
}
export function isSessionDead(sid: string): boolean {
  return __deadSessions.has(sid);
}

export class SessionGoneError extends Error {
  sessionId: string;
  constructor(sessionId: string, message = "session_gone") {
    super(message);
    this.name = "SessionGoneError";
    this.sessionId = sessionId;
  }
}

export const api = {
  health: () => req<{ status: string }>(`/global/health`),

  listSessions: () => req<SessionInfo[]>(`/session`),
  createSession: (title?: string) =>
    req<SessionInfo>(`/session`, {
      method: "POST",
      body: JSON.stringify(title ? { title } : {}),
    }),
  // Tell the server which chat is the dedicated Self-Improvement chat so its agent
  // is pointed at the live project source (/app/workspace/opencode-ui).
  setSelfImproveSession: (id: string) =>
    req<{ status: string; id: string }>(`/settings/self-improve/session`, {
      method: "POST",
      body: JSON.stringify({ id }),
    }),
  getSession: (id: string) => req<SessionInfo>(`/session/${id}`),
  deleteSession: (id: string) =>
    req<void>(`/session/${id}`, { method: "DELETE" }),
  abortSession: (id: string) =>
    req<void>(`/session/${id}/abort`, { method: "POST" }),
  listMessages: (id: string) => req<Message[]>(`/session/${id}/message`),

  prompt: (id: string, text: string, model?: PromptModel) =>
    req<Message>(
      `/session/${id}/message`,
      {
        method: "POST",
        body: JSON.stringify({
          parts: [{ type: "text", text }],
          ...(model ? { model } : {}),
        }),
      },
      PROMPT_REQUEST_TIMEOUT_MS,
    ),

  promptWithParts: (
    id: string,
    parts: Record<string, unknown>[],
    model?: PromptModel,
    systemInstruction?: string,
    signal?: AbortSignal,
  ) =>
    req<Message>(
      `/session/${id}/message`,
      {
        method: "POST",
        body: JSON.stringify({
          parts,
          ...(model ? { model } : {}),
          ...(systemInstruction ? { system: systemInstruction } : {}),
        }),
        signal,
      },
      PROMPT_REQUEST_TIMEOUT_MS,
    ),

  respondPermission: (
    id: string,
    permissionId: string,
    response: "once" | "always" | "reject",
  ) =>
    req<void>(`/session/${id}/permissions/${permissionId}`, {
      method: "POST",
      body: JSON.stringify({ response }),
    }),

  // v2 question API — правильный способ ответить на интерактивный tool "question"
  listPendingQuestions: (id: string) =>
    req<{
      data: Array<{ id: string; sessionID: string; questions: unknown[] }>;
    }>(`/session/${id}/question`),
  replyQuestion: (id: string, requestId: string, answers: string[][]) =>
    req<void>(`/session/${id}/question/${requestId}/reply`, {
      method: "POST",
      body: JSON.stringify({ answers }),
    }),
  rejectQuestion: (id: string, requestId: string) =>
    req<void>(`/session/${id}/question/${requestId}/reject`, {
      method: "POST",
      body: "{}",
    }),

  listDir: (path = ".", sessionId?: string | null) =>
    req<FileNode[]>(
      `/file?path=${encodeURIComponent(path)}${sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : ""}`,
    ),
  // Релиз 3: рекурсивный листинг всего воркспейса одним запросом
  // (см. server/routes/tree.mjs) — убирает N+1 в поллере файлового дерева.
  listTree: (sessionId: string) =>
    req<FileNode[]>(
      `/workspace/tree?sessionId=${encodeURIComponent(sessionId)}`,
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
    return res.json() as Promise<{
      ok: boolean;
      written: number;
      errors?: string[];
    }>;
  },

  uploadFile: (
    file: File,
    onProgress?: (pct: number) => void,
    sessionId?: string | null,
  ): Promise<{
    ok: boolean;
    path: string;
    agentPath?: string | null;
    size: number;
    entryCount?: number | null;
  }> =>
    new Promise((resolve, reject) => {
      const base = `${config.baseUrl}/workspace/upload`;
      const url = sessionId
        ? `${base}?sessionId=${encodeURIComponent(sessionId)}`
        : base;
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
            reject(
              new Error(JSON.parse(xhr.responseText)?.error || xhr.statusText),
            );
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
    req<{
      connected?: string[];
      all?: unknown[];
      default?: Record<string, string>;
    }>(`/provider`),

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

  listSelfImprovePRs: (state: "open" | "closed" | "all" = "all") =>
    req<{
      prs: Array<{
        number: number;
        title: string;
        url: string;
        state: "open" | "closed";
        merged: boolean;
        mergeable_state?: string;
        head_branch: string;
        created_at: string;
        updated_at: string;
        merged_at: string | null;
        auto_merge: boolean;
      }>;
    }>(`/self-improve/prs?state=${state}`),
};

/**
 * SSE URL — cookie is sent automatically same-origin by EventSource.
 *
 * REAL-TIME STREAMING FIX: OpenCode's event bus is scoped to the app
 * `directory`. Per-session prompts run under
 * `/app/workspace/sessions/{id}/workspace`, so a bare `/event` subscription
 * (default directory) never receives their `message.part.updated` token
 * events — the UI then only refreshed from the 3s HTTP fallback poller,
 * which made responses appear in batches. Passing `?sessionId=` lets the
 * proxy append the session's `directory=` (isolation invariant #1) so token
 * deltas stream to the client in real time, like ChatGPT/Claude.
 */
export function eventUrl(sessionId?: string | null): string {
  if (sessionId && !sessionId.startsWith("tmp_")) {
    return `${config.baseUrl}/event?sessionId=${encodeURIComponent(sessionId)}`;
  }
  return `${config.baseUrl}/event`;
}
