import { eventUrl } from "./client";
import type { AppEvent } from "./types";

type Handler = (event: AppEvent) => void;

// OpenCode emits these as *named* SSE events (`event: <type>`).
// We register a listener for each so they are captured (EventSource only fires
// `onmessage` for unnamed events).
const NAMED_TYPES = [
  "session.created",
  "session.updated",
  "session.removed",
  "message.updated",
  "message.part.updated",
  "message.part.delta",
  "message.removed",
  "session.status",
  "permission.asked",
  "permission.responded",
];

export type StreamStatus = "connecting" | "open" | "closed";

export class EventStream {
  private es: EventSource | null = null;
  private handlers = new Set<Handler>();
  private retry: ReturnType<typeof setTimeout> | null = null;
  private url: string;
  private sessionId: string | null;
  private attempt = 0;
  private maxAttempts = 50; // stop after ~50 attempts (several minutes of backoff)
  status: StreamStatus = "connecting";

  constructor(url?: string, sessionId?: string | null) {
    this.sessionId = sessionId ?? null;
    this.url = url ?? eventUrl(this.sessionId);
  }

  /** Rebuild the URL with a fresh token (call after re-login). */
  updateToken() {
    this.url = eventUrl(this.sessionId);
    // Force reconnect with the new token
    if (this.es) {
      this.es.close();
      this.es = null;
      this.attempt = 0;
      this.connect();
    }
  }

  /** Switch to a different session's event stream. */
  switchSession(sessionId: string | null) {
    this.sessionId = sessionId;
    this.url = eventUrl(sessionId);
    if (this.es) {
      this.es.close();
      this.es = null;
      this.attempt = 0;
      this.connect();
    }
  }

  connect() {
    if (this.es) this.es.close();
    this.status = "connecting";
    try {
      this.es = new EventSource(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.es.onopen = () => {
      this.status = "open";
      this.attempt = 0; // reset backoff on successful connection
    };
    this.es.onerror = () => {
      this.status = "closed";
      this.es?.close();
      this.scheduleReconnect();
    };

    this.es.onmessage = (m) => this.dispatch("message", m.data);
    for (const t of NAMED_TYPES) {
      this.es.addEventListener(t, ((e: MessageEvent) => this.dispatch(t, e.data)) as EventListener);
    }
  }

  private dispatch(namedType: string, rawData: string) {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(rawData);
    } catch {
      parsed = { raw: rawData };
    }
    const ev: AppEvent =
      parsed && typeof parsed === "object" && "type" in parsed && "properties" in parsed
        ? (parsed as unknown as AppEvent)
        : { type: namedType, properties: parsed };
    // Debug logging disabled in production — enable via localStorage.setItem("opencode_debug", "1")
    if (typeof window !== "undefined" && localStorage.getItem("opencode_debug") === "1") {
      console.log("[SSE] event:", namedType, "data:", parsed, "ev:", ev);
    }
    for (const h of this.handlers) h(ev);
  }

  private scheduleReconnect() {
    if (this.retry) return;
    if (this.attempt >= this.maxAttempts) {
      console.warn("[SSE] Max reconnect attempts reached. Giving up.");
      this.status = "closed";
      return;
    }
    // Exponential backoff: 1s, 2s, 4s, 8s, ... capped at 30s.
    const delay = Math.min(1000 * 2 ** this.attempt++, 30000);
    this.retry = setTimeout(() => {
      this.retry = null;
      this.connect();
    }, delay);
  }

  on(handler: Handler) {
    this.handlers.add(handler);
    if (!this.es) this.connect();
    return () => this.handlers.delete(handler);
  }

  close() {
    if (this.retry) clearTimeout(this.retry);
    this.es?.close();
    this.es = null;
    this.status = "closed";
  }
}
