import { eventUrl } from "./client";
import type { AppEvent } from "./types";

type Handler = (event: AppEvent) => void;

// OpenCode emits these as *named* SSE events (`event: <type>`).
// We register a listener for each so they are captured (EventSource only fires
// `onmessage` for unnamed events).
// P3: список вынесен в конфиг — по умолчанию используется DEFAULT_NAMED_TYPES,
// но EventStream принимает свой список третьим аргументом конструктора
// (когда новая версия opencode добавит типы событий, их можно подключить
// без правки этого файла).
export const DEFAULT_NAMED_TYPES: readonly string[] = [
  "session.created",
  "session.updated",
  "session.removed",
  "message.updated",
  "message.part.updated",
  "message.part.delta",
  "message.removed",
  "session.status",
  "session.idle",
  "permission.asked",
  "permission.responded",
];

export type StreamStatus = "connecting" | "open" | "closed";

// Module-level mirror of the latest EventStream status. The app runs a single
// EventStream instance (see router.tsx), so consumers outside React (e.g. the
// send() HTTP poller in messagesSlice) can cheaply ask "is SSE healthy now?".
let activeStreamStatus: StreamStatus = "closed";
export function getActiveStreamStatus(): StreamStatus {
  return activeStreamStatus;
}

// P2-fix: глобального статуса недостаточно — единственный EventStream
// подписан на события ОДНОЙ (активной) сессии. Для фоновой сессии
// SSE может быть «open», но её события в клиент не приходят. Поэтому
// здоровье SSE нужно спрашивать per-session: стрим открыт И подписан
// именно на эту сессию (null = глобальная шина без фильтра по сессии,
// тогда события получают все сессии).
let activeStreamSessionId: string | null = null;
export function isSseHealthyForSession(sessionId: string): boolean {
  return (
    activeStreamStatus === "open" &&
    (activeStreamSessionId === null || activeStreamSessionId === sessionId)
  );
}

export class EventStream {
  private es: EventSource | null = null;
  private handlers = new Set<Handler>();
  private retry: ReturnType<typeof setTimeout> | null = null;
  private tokenRefreshDebounce: ReturnType<typeof setTimeout> | null = null;
  private url: string;
  private sessionId: string | null;
  private attempt = 0;
  private maxAttempts = 50; // после ~50 быстрых попыток — редкие ретраи раз в минуту
  // True after a real transport error — used to trigger a one-shot catch-up
  // refetch on the next successful open (SSE has no Last-Event-ID replay).
  private hadDrop = false;
  private namedTypes: readonly string[];
  status: StreamStatus = "connecting";

  private setStatus(s: StreamStatus) {
    this.status = s;
    activeStreamStatus = s;
  }

  constructor(
    url?: string,
    sessionId?: string | null,
    namedTypes?: readonly string[],
  ) {
    this.sessionId = sessionId ?? null;
    activeStreamSessionId = this.sessionId;
    this.url = url ?? eventUrl(this.sessionId);
    this.namedTypes = namedTypes ?? DEFAULT_NAMED_TYPES;
  }

  /** Rebuild the URL with a fresh token (call after re-login). */
  updateToken() {
    // URL обновляем сразу — любой новый connect() уже пойдёт с свежим токеном.
    this.url = eventUrl(this.sessionId);
    // P1-fix: дебаунс переподключения — несколько подряд обновлений
    // токена (re-login, гонки рефреша в нескольких вкладках) больше
    // не рвут стрим на каждый вызов; пересоединяемся один раз
    // спустя 250 мс тишины.
    if (!this.es && !this.tokenRefreshDebounce) return;
    if (this.tokenRefreshDebounce) clearTimeout(this.tokenRefreshDebounce);
    this.tokenRefreshDebounce = setTimeout(() => {
      this.tokenRefreshDebounce = null;
      this.url = eventUrl(this.sessionId);
      if (this.es) {
        this.es.close();
        this.es = null;
      }
      this.attempt = 0;
      this.connect();
    }, 250);
  }

  /** Switch to a different session's event stream. */
  switchSession(sessionId: string | null) {
    // No-op when the session hasn't changed — avoids needless SSE reconnect
    // churn (each reconnect drops in-flight token events for a moment).
    if (sessionId === this.sessionId) return;
    this.sessionId = sessionId;
    activeStreamSessionId = sessionId;
    this.url = eventUrl(sessionId);
    this.attempt = 0;
    if (this.retry) {
      clearTimeout(this.retry);
      this.retry = null;
    }
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    // Connect immediately if anyone is listening (or a connection existed).
    if (this.handlers.size > 0) this.connect();
  }

  connect() {
    // P1-fix: защита от двойного вызова connect() — если соединение уже
    // открыто или открывается, не создаём параллельный EventSource
    // (двойная подписка = дубли событий и лишняя нагрузка на прокси).
    if (this.es && this.es.readyState !== EventSource.CLOSED) return;
    // Отменяем запланированный реконнект, чтобы его таймер не
    // породил второй connect() поверх только что созданного.
    if (this.retry) {
      clearTimeout(this.retry);
      this.retry = null;
    }
    if (this.es) this.es.close();
    this.setStatus("connecting");
    try {
      this.es = new EventSource(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.es.onopen = () => {
      const hadDrop = this.hadDrop;
      this.hadDrop = false;
      this.setStatus("open");
      this.attempt = 0; // reset backoff on successful connection
      // P1-fix: SSE не докидывает пропущенные во время разрыва события —
      // после реального дропа шлём синтетическое событие, по которому
      // стор один раз дотягивает историю активной сессии.
      if (hadDrop) {
        const ev = {
          type: "stream.reconnected",
          properties: {},
        } as unknown as AppEvent;
        this.emit(ev);
      }
    };
    this.es.onerror = () => {
      this.hadDrop = true;
      this.setStatus("closed");
      this.es?.close();
      // P1-fix: обнуляем ссылку ДО планирования реконнекта, иначе
      // guard в connect() (`es && readyState !== CLOSED`) увидит
      // ещё не-CLOSED (в настоящем EventSource после ошибки состояние
      // может быть CONNECTING) и early-return'ит — второй EventSource
      // не создастся, реконнект «теряется».
      this.es = null;
      this.scheduleReconnect();
    };

    this.es.onmessage = (m) => this.dispatch("message", m.data);
    for (const t of this.namedTypes) {
      this.es.addEventListener(t, ((e: MessageEvent) =>
        this.dispatch(t, e.data)) as EventListener);
    }
  }

  private dispatch(namedType: string, rawData: string) {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(rawData);
    } catch {
      // P0-fix: битый чанк не маскируем под нормальное событие —
      // шлём выделенное stream.corrupted, по которому стор покажет
      // плашку «Стрим прерван» вместо непредсказуемой обработки
      // сырой строки всеми обработчиками.
      const ev: AppEvent = {
        type: "stream.corrupted",
        properties: { raw: rawData, sourceType: namedType },
      } as unknown as AppEvent;
      this.emit(ev);
      return;
    }
    const ev: AppEvent =
      parsed &&
      typeof parsed === "object" &&
      "type" in parsed &&
      "properties" in parsed
        ? (parsed as unknown as AppEvent)
        : { type: namedType, properties: parsed };
    // Debug logging disabled in production — enable via localStorage.setItem("opencode_debug", "1")
    if (
      typeof window !== "undefined" &&
      localStorage.getItem("opencode_debug") === "1"
    ) {
      console.log("[SSE] event:", namedType, "data:", parsed, "ev:", ev);
    }
    this.emit(ev);
  }

  // P0-fix: исключение в одном подписчике не должно прерывать доставку
  // события остальным и ломать жизненный цикл подключения
  // (бросок из onopen/onmessage). Ошибку логируем и продолжаем.
  private emit(ev: AppEvent) {
    for (const h of this.handlers) {
      try {
        h(ev);
      } catch (err) {
        console.error("[SSE] handler error for event:", ev.type, err);
      }
    }
  }

  private scheduleReconnect() {
    if (this.retry) return;
    // P1-fix: после исчерпания быстрого экспоненциального бэкоффа
    // не сдаёмся навсегда (раньше вкладка оставалась «мёртвой» до
    // ручной перезагрузки) — переходим на редкие попытки раз в
    // минуту, пока сервер не вернётся.
    let delay: number;
    if (this.attempt >= this.maxAttempts) {
      console.warn(
        "[SSE] Max fast reconnect attempts reached. Retrying every 60s.",
      );
      delay = 60000;
    } else {
      // Exponential backoff: 1s, 2s, 4s, 8s, ... capped at 30s.
      delay = Math.min(1000 * 2 ** this.attempt++, 30000);
    }
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

  /** Reset backoff and reconnect immediately (call on window online/focus). */
  wake() {
    this.attempt = 0;
    if (this.retry) {
      clearTimeout(this.retry);
      this.retry = null;
    }
    if (this.status !== "open" && this.handlers.size > 0) this.connect();
  }

  close() {
    if (this.retry) clearTimeout(this.retry);
    if (this.tokenRefreshDebounce) {
      clearTimeout(this.tokenRefreshDebounce);
      this.tokenRefreshDebounce = null;
    }
    this.es?.close();
    this.es = null;
    this.setStatus("closed");
  }
}
