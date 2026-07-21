import { isAbortError, sessionSignal } from "../../api/abortRegistry";
import { api, SessionGoneError } from "../../api/client";
import { statusText, strField } from "../../api/eventGuards";
import { isSseHealthyForSession } from "../../api/events";
import type { ProcessedFile } from "../../api/files";
import { mergeMessages as mergeMessagesDeterministic } from "../../api/messageMerge";
import type {
  Message,
  Part,
  PermissionRequest,
  SessionInfo,
  SessionStatus,
} from "../../api/types";
import {
  normalizeMessage,
  normalizeMessages,
  patchPart,
  patchPartDelta,
  upsertMessage,
} from "../helpers";
import { sessionFsm } from "../sessionFsm";
import type { MessagesSlice, Slice } from "../types";
import { byUpdated } from "../types";
import { waitForSessionCreation } from "./sessionsSlice";

// P1.6 FSM: per-session состояние busy/idle и idle-резолверы вынесены в
// ../sessionFsm.ts (бывшие __locallyBusy / __idleResolvers). Поведение 1:1.
// Safety watchdog only; normal completion comes from SSE session.idle,
// the final prompt response, or HTTP reconciliation. Keep it longer than
// ordinary multi-tool self-improvement runs to avoid false completion.
const SEND_HARD_TIMEOUT_MS = 15 * 60 * 1000; // 15 min safety limit

// ---------------------------------------------------------------------------
// Релиз 4: send() разбит на чистые функции — их можно тестировать без стора и сети,
// а сам send() остаётся оркестратором: сессия, статусы, ожидание финала.
// ---------------------------------------------------------------------------

// P1.1 — изоляция workspace обеспечивается сервером (?directory=): инструкция без
// абсолютных путей, чтобы не протекала структура чужих чатов.
const SYSTEM_INSTRUCTION = `You are in an isolated workspace for this chat, like Claude.ai. Files from other chats are NOT visible. Never use absolute paths from other chats. New chat = new memory + empty workspace. Keep the user visibly informed while working: before the first meaningful action, and then after every 1–2 meaningful tool actions or when switching task phase, write one short, concrete progress sentence in the user's language before continuing. Describe the outcome or next step (for example: "Добавляю гостевой вход и убираю форму авторизации."), not hidden reasoning. Do not narrate routine file reads one by one and do not spam repetitive updates. When you create a user-downloadable artifact through Bash or another tool (such as a PDF, spreadsheet, document, image, archive, audio, video, or other deliverable), include a separate final-answer line exactly in this format: 📎 filename.ext → relative/path/from/workspace. The path must be relative to the current workspace. This makes the artifact appear as a downloadable file card in chat.`;

/** Attachment-части для оптимистичного user-сообщения (чистая функция). */
export function buildAttachmentParts(attachments: ProcessedFile[]): Part[] {
  return attachments.map((a) => ({
    type: "attachment" as const,
    name: a.name,
    size: a.size,
    kind: a.kind,
    path: a.uploadedPath || undefined,
    dataUrl: a.dataUrl || undefined,
  }));
}

/** Оптимистичное user-сообщение (генерация локального id — единственный side effect). */
function buildUserMessage(text: string, attachments: ProcessedFile[]): Message {
  return {
    id: newLocalMessageId(),
    role: "user",
    parts: [...buildAttachmentParts(attachments), { type: "text", text }],
  };
}

/**
 * Сборка частей prompt-запроса из вложений и текста пользователя.
 * Вынесено из send() 1:1 (чистая функция).
 */
export function buildPromptParts(
  attachments: ProcessedFile[],
  text: string,
): Record<string, unknown>[] {
  const parts: Record<string, unknown>[] = [];
  const promptText = text;
  for (const att of attachments) {
    // Картинки и PDF — data-URL file-part (vision-модель видит содержимое).
    if ((att.kind === "image" || att.kind === "pdf") && att.part) {
      parts.push(att.part);
      continue;
    }
    // Текстовые файлы — полноценный file-part с file://-путём:
    // opencode сам прочитает содержимое из workspace сессии.
    if (att.kind === "text" && att.agentPath) {
      parts.push({
        type: "file",
        mime: "text/plain",
        filename: att.name,
        url: `file://${encodeURI(att.agentPath)}`,
      });
      continue;
    }
    // Zip и прочие бинарники уже лежат в workspace — отдаём агенту
    // отдельную 📎-часть с путём (UI рендерит её как файл-чип,
    // текст пользователя остаётся чистым).
    if (att.uploadedPath) {
      const hint =
        typeof att.entryCount === "number"
          ? ` (${att.entryCount} файлов внутри)`
          : "";
      const note =
        att.kind === "zip" ? " — это zip-архив, ещё не распакован" : "";
      parts.push({
        type: "text",
        text: `📎 ${att.name} → uploads/${att.name}${hint}${note}`,
      });
      continue;
    }
    // Fallback (загрузка на сервер не удалась): старое поведение.
    if (att.part) parts.push(att.part);
    else if (att.textPart) parts.push(att.textPart);
  }
  parts.push({ type: "text", text: promptText });
  return parts;
}

/**
 * Детекция финала ответа для HTTP-поллера: последний assistant-message,
 * его finish/completed и сигнатура состояния (чистая функция).
 */
export function assistantFinishState(msgs: Message[]) {
  const lastAsst = [...msgs].reverse().find((m) => m.role === "assistant");
  const finish = lastAsst?.info?.finish;
  const completedAt = lastAsst?.info?.time?.completed;
  const isDone = finish === "stop" || finish === "error" || !!completedAt;
  // сигнатура состояния: id последнего + время завершения + счётчик parts
  const sig = `${lastAsst?.id || ""}|${completedAt || 0}|${lastAsst?.parts?.length || 0}|${finish || ""}`;
  return { isDone, sig, completedAt };
}

// Релиз 3: буферизация стрим-дельт. Сотни SSE-дельт в секунду превращаются
// в максимум ~60 обновлений стора в секунду (раз в DELTA_FLUSH_MS) — иначе
// каждый токен заставляет React пересчитывать всё дерево сообщений.
const DELTA_FLUSH_MS = 16;

let __activeStoreFlush: (() => void) | null = null;
/**
 * Досылает накопленные стрим-дельты одним обновлением стора.
 * Экспортируется для тестов (там нет ожидания 16мс-таймера).
 */
export function flushStreamDeltas() {
  __activeStoreFlush?.();
}

/**
 * Collision-free id for optimistic local messages. `Date.now()` collides on
 * a fast double send (same millisecond); `crypto.randomUUID()` cannot. The
 * fallback covers non-secure contexts (plain HTTP), where randomUUID is
 * unavailable. The `local_` prefix is load-bearing: all optimistic-message
 * correlation checks `id.startsWith("local_")`.
 */
function newLocalMessageId(): string {
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `local_${uuid}`;
}

export const createMessagesSlice: Slice<MessagesSlice> = (set, get) => {
  __activeStoreFlush = () => get().flushStreamDeltas();
  return {
    messages: {},
    attachments: [],
    failedSendText: null,
    _deltaBuffer: new Map(),
    _flushTimer: null,

    flushStreamDeltas: () => {
      const timer = get()._flushTimer;
      if (timer) {
        clearTimeout(timer);
        set({ _flushTimer: null });
      }
      const buf = get()._deltaBuffer;
      if (!buf || buf.size === 0) return;
      const pending = [...buf.values()];
      buf.clear();
      set((s) => {
        let messages = s.messages;
        for (const d of pending) {
          messages = {
            ...messages,
            [d.sid]: patchPartDelta(
              messages[d.sid] ?? [],
              d.messageID,
              d.partID,
              d.field,
              d.text,
            ),
          };
        }
        return { messages };
      });
    },

    addAttachments: (files) =>
      set((s) => ({ attachments: [...s.attachments, ...files] })),

    removeAttachment: (name) =>
      set((s) => ({ attachments: s.attachments.filter((a) => a.name !== name) })),

    clearAttachments: () => set({ attachments: [] }),

    clearFailedSendText: () => set({ failedSendText: null }),

  send: async (text) => {
    const { currentID, newSession, selectedModel } = get();
    let sid = currentID;
    // Handle tmp_ optimistic IDs — wait for real session or create new one (Claude-like)
    if (!sid || sid.startsWith("tmp_")) {
      if (sid?.startsWith("tmp_")) {
        // Optimistic creation is in progress — await its completion event
        // instead of a fixed 300ms nap: on a slow backend the nap ended
        // before the real id appeared, the forced newSession() bailed out on
        // the creatingSession guard, and the message was silently dropped.
        await waitForSessionCreation();
        sid = get().currentID;
        if (sid?.startsWith("tmp_")) {
          // Still temp, force create real session
          await newSession();
          sid = get().currentID;
        }
      } else {
        await newSession();
        sid = get().currentID;
      }
      if (!sid || sid.startsWith("tmp_")) return;
    }
    const sidStr = sid as string;

    const currentAttachments = get().attachments;
    // Релиз 4: сборка оптимистичного сообщения вынесена в чистые функции.
    const userMsg = buildUserMessage(text, currentAttachments);
    const requestGen = sessionFsm.beginRequest(sidStr);
    set((s) => ({
      status: { ...s.status, [sidStr]: "busy" },
      messages: {
        ...s.messages,
        [sidStr]: [...(s.messages[sidStr] ?? []), userMsg],
      },
    }));

    // P0.3 — deterministic source-aware merge (replaces JSON-length heuristic)
    const mergeMessages = (msgs: Message[], existing: Message[]): Message[] => {
      return mergeMessagesDeterministic(msgs, existing);
    };

    const doFinalFetch = async () => {
      try {
        const msgs = normalizeMessages(await api.listMessages(sidStr));
        set((s) => {
          const existing = s.messages[sidStr] ?? [];
          const merged = mergeMessages(msgs, existing);
          return { messages: { ...s.messages, [sidStr]: merged } };
        });
      } catch {
        // non-fatal
      }
    };

    try {
      // Релиз 4: сборка prompt-частей вынесена в чистую функцию buildPromptParts —
      // send() остаётся оркестратором (сессия, статусы, ожидание финала).
      const parts = buildPromptParts(get().attachments, text);

      // Fire-and-forget prompt: сервер сам стримит события через SSE.
      // Не полагаемся на возврат promptWithParts как индикатор финиша —
      // ждём ЛИБО session.idle из SSE, ЛИБО подтверждённый через HTTP-polling
      // финал (два опроса подряд показывают одинаковое finish + отсутствие новых сообщений).
      // Это защищает от нестабильного SSE (мобильная сеть, VPN).
      // Retryable prompt: временные 503 или сетевые ошибки не должны
      // сбрасывать индикатор работы ассистента. Повторяем до 2 раз.
      async function retryablePrompt(
        sidStr: string,
        parts: Record<string, unknown>[],
        model?: import("../../api/client").PromptModel,
        systemInstruction?: string,
        signal?: AbortSignal,
        retries = 2,
      ) {
        let lastErr: Error | null = null;
        for (let i = 0; i <= retries; i++) {
          try {
            return await api.promptWithParts(
              sidStr,
              parts,
              model,
              systemInstruction,
              signal,
            );
          } catch (err) {
            lastErr = err as Error;
            const msg = (err as Error).message || "";
            const isRetryable =
              msg.includes("503") ||
              msg.includes("unavailable") ||
              msg.includes("timed out") ||
              msg.includes("Failed to fetch");
            if (!isRetryable || i === retries) throw err;
            // Короткая пауза перед повтором — даём серверу/сети восстановиться.
            await new Promise((r) => setTimeout(r, 800));
          }
        }
        throw lastErr;
      }

      const promptPromise = retryablePrompt(
        sidStr,
        parts,
        selectedModel ?? undefined,
        SYSTEM_INSTRUCTION,
        sessionSignal(sidStr),
        2,
      );

      // P2-fix: вложения уже ушли в prompt — очищаем композер сразу,
      // не дожидаясь конца генерации. При ошибке send() вернём их обратно.
      set({ attachments: [] });

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const done = (reason: string) => {
          if (settled) return;
          settled = true;
          resolve();
        };

        // --- Регистрируем SSE-резолвер, поддерживая множественные send() ---
        // Если для этой сессии уже есть резолвер (юзер быстро жмёт 2 раза),
        // не теряем его — sessionFsm вызывает оба цепочкой.
        sessionFsm.onIdle(
          sidStr,
          () => {
            done("sse:session.idle");
          },
          requestGen,
        );

        // --- HTTP-polling подтверждение финала (страховка от битого SSE) ---
        // Проверяем состояние каждые 3s. Считаем финалом, когда:
        //   - есть хотя бы одно assistant-сообщение
        //   - у него info.finish === "stop"|"error" ИЛИ info.time.completed
        //   - И это состояние подтверждено (3s стабильности)
        // Это защищает от промежуточных finish:"stop" на reasoning-стадии.
        let stableCount = 0;
        let lastSignature = "";
        const httpPoller = setInterval(async () => {
          if (settled) {
            clearInterval(httpPoller);
            return;
          }
          try {
            const msgs = await api.listMessages(sidStr);
            // REAL-TIME FIX: раньше поллер ПОЛНОСТЬЮ перезаписывал стор
            // серверным снапшотом каждые 3s — это откатывало/дёргало текст,
            // который уже пришёл по SSE, и ответ визуально появлялся
            // «пачками». Теперь используем детерминированный merge:
            // локальный стриминговый текст (длиннее и является префиксным
            // расширением серверного) сохраняется, пока сервер не финализирует
            // сообщение. Поллер остаётся только страховкой от битого SSE.
            // P0-fix: пока SSE здоров ("open"), поллер служит ТОЛЬКО
            // детектором финала и НЕ пишет снапшот в стор — снапшот на
            // мгновение отстаёт от SSE-дельт и откатывал стриминговые
            // reasoning/tool-части (дёргание карточек). Мержим в стор
            // только когда SSE реально не работает.
            // P2-fix: проверяем здоровье SSE именно ДЛЯ ЭТОЙ сессии:
            // глобальный «open» обманывал фоновый чат после переключения —
            // стрим подписан на другую сессию, события сюда не идут,
            // а поллер молчал — текст замирал до переключения обратно.
            const sseHealthy = isSseHealthyForSession(sidStr);
            if (!sseHealthy && Array.isArray(msgs) && msgs.length > 0) {
              set((s) => {
                const existing = s.messages[sidStr] ?? [];
                const merged = mergeMessages(
                  normalizeMessages(msgs as Message[]),
                  existing,
                );
                return { messages: { ...s.messages, [sidStr]: merged } };
              });
            }
            const { isDone, sig, completedAt } = assistantFinishState(
              msgs as Message[],
            );
            if (isDone && sig === lastSignature) {
              stableCount++;
              if (stableCount >= 1) {
                clearInterval(httpPoller);
                clearTimeout(timeoutId);
                sessionFsm.clearIdleResolver(sidStr, requestGen);
                done("http:stable-finish");
              }
            } else {
              stableCount = isDone ? 1 : 0;
              lastSignature = sig;
              // Fix Stop button hang: if we have completedAt (final message), finish immediately without waiting for second poll
              if (isDone && completedAt) {
                clearInterval(httpPoller);
                clearTimeout(timeoutId);
                sessionFsm.clearIdleResolver(sidStr, requestGen);
                done("http:completed-immediate");
              }
            }
          } catch (pollErr) {
            // UX-fix: если сессия мертва — прекращаем полить, дальше обработается в catch send()
            if (pollErr instanceof SessionGoneError) {
              clearInterval(httpPoller);
              clearTimeout(timeoutId);
              sessionFsm.clearIdleResolver(sidStr, requestGen);
              if (!settled) {
                settled = true;
                reject(pollErr);
              }
              return;
            }
            // иначе — сеть моргает, продолжаем
          }
        }, 3000);

        // --- Страховочный таймаут (короче, чем было — 90 сек без активности) ---
        const timeoutId = setTimeout(() => {
          if (settled) return;
          console.warn(
            `[send] hard timeout after ${SEND_HARD_TIMEOUT_MS}ms — forcing completion`,
          );
          clearInterval(httpPoller);
          sessionFsm.clearIdleResolver(sidStr, requestGen);
          done("hard-timeout");
        }, SEND_HARD_TIMEOUT_MS);

        // --- Prompt response handling — if server returns final message directly, complete immediately (fixes Stop hanging)
        promptPromise
          .then((responseMsg) => {
            const finish = responseMsg?.info?.finish;
            const completed = responseMsg?.info?.time?.completed;
            if (finish === "stop" || finish === "error" || completed) {
              clearInterval(httpPoller);
              clearTimeout(timeoutId);
              sessionFsm.clearIdleResolver(sidStr, requestGen);
              done(
                finish === "error"
                  ? "prompt:finish-error"
                  : "prompt:finish-stop",
              );
            }
          })
          .catch((e) => {
            // Релиз 4: отмена по «Стоп» (AbortError) — не ошибка отправки.
            // Интервал и таймаут не трогаем: финал подтвердят SSE session.idle
            // или поллер — сервер финализирует ответ после abort.
            if (isAbortError(e)) return;
            clearInterval(httpPoller);
            clearTimeout(timeoutId);
            sessionFsm.clearIdleResolver(sidStr, requestGen);
            if (!settled) {
              settled = true;
              reject(e);
            }
          });
      }).finally(() => {
        // no extra poll interval
      });
    } catch (e) {
      sessionFsm.markIdle(sidStr, requestGen);
      if (e instanceof SessionGoneError) {
        console.warn(
          "[send] session gone on backend, recreating:",
          e.sessionId,
        );
        set((s) => {
          const messages = { ...s.messages };
          delete messages[sidStr];
          return {
            sessions: s.sessions.filter((x) => x.id !== sidStr),
            messages,
            currentID: s.currentID === sidStr ? null : s.currentID,
            status: { ...s.status, [sidStr]: "idle" as SessionStatus },
          };
        });
        try {
          await get().newSession();
          const newSid = get().currentID;
          if (newSid && !newSid.startsWith("tmp_")) {
            // Race-fix: пока первая попытка висела, пользователь мог уже
            // прикрепить НОВЫЕ файлы к следующему сообщению. Не затираем
            // их старым снимком и не отдаём авторетраю (иначе новые
            // файлы ушли бы под старым текстом) — возвращаем текст в
            // Composer через failedSendText для ручной отправки.
            if (get().attachments.length > 0) {
              set({ failedSendText: text });
              return;
            }
            // P2-fix: вложения были очищены при первой попытке — вернём,
            // чтобы повторная отправка ушла с ними (функциональный set —
            // не перезаписываем вложения, появившиеся между проверкой и
            // записью).
            if (currentAttachments.length > 0)
              set((s) => ({
                attachments:
                  s.attachments.length === 0
                    ? currentAttachments
                    : s.attachments,
              }));
            void get().send(text);
          }
        } catch (recErr) {
          set((_s) => ({ error: (recErr as Error).message }));
        }
        return;
      }
      set((s) => ({
        error: (e as Error).message,
        // P2-fix: не терять набранный текст — Composer вернёт его в поле ввода.
        failedSendText: text,
        status: { ...s.status, [sidStr]: "error" },
        messages: {
          ...s.messages,
          [sidStr]: (s.messages[sidStr] ?? []).filter(
            (m) => m.id !== userMsg.id,
          ),
        },
        // P2-fix: вложения были очищены при отправке — возвращаем.
        attachments:
          s.attachments.length === 0 ? currentAttachments : s.attachments,
      }));
      return;
    }

    await doFinalFetch();
    sessionFsm.markIdle(sidStr, requestGen);
    set((s) => {
      // Релиз 4: если за время ожидания стартовал более новый send(),
      // не сбиваем его busy-статус устаревшим idle.
      if (!sessionFsm.isCurrent(sidStr, requestGen)) return {};
      const currentStatus = s.status[sidStr];
      const finalStatus: SessionStatus =
        currentStatus === "error" ? "error" : "idle";
      return {
        status: { ...s.status, [sidStr]: finalStatus },
      };
    });
  },

  applyEvent: (e) => {
    // Релиз 3: любое не-дельтовое событие сначала досылает буфер дельт,
    // чтобы не нарушать порядок применения (например, message.part.updated
    // затирает поле целиком и должен видеть уже применённые дельты).
    if (e.type !== "message.part.delta") get().flushStreamDeltas();
    const p = e.properties;
    const sid =
      p.sessionID ||
      p.session_id ||
      p.sessionId ||
      strField(p.part, "sessionID") ||
      strField(p.info, "sessionID") ||
      strField(p.message, "sessionID") ||
      "";

    switch (e.type) {
      case "session.created":
      case "session.updated": {
        if (!p.session) break;
        set((s) => ({
          sessions: [
            p.session as SessionInfo,
            ...s.sessions.filter((x) => x.id !== p.session?.id),
          ].sort(byUpdated),
        }));
        break;
      }
      case "session.removed": {
        if (!sid) break;
        set((s) => {
          const messages = { ...s.messages };
          delete messages[sid];
          return {
            sessions: s.sessions.filter((x) => x.id !== sid),
            messages,
            currentID: s.currentID === sid ? null : s.currentID,
          };
        });
        break;
      }
      case "session.status": {
        if (!sid || !p.status) break;
        const st = statusText(p.status);
        // Fix Stop button hang: when locallyBusy and st===idle (real end), resolve AND set idle immediately
        // Previously it only resolved and broke without setting status, causing Stop to hang until http polling stable
        if (sessionFsm.isBusy(sid) && st === "idle") {
          sessionFsm.resolveIdle(sid);
          // P0.4: Set idle immediately, not waiting for http polling
          set((s) => ({
            status: { ...s.status, [sid]: "idle" as SessionStatus },
          }));
          break;
        }
        set((s) => ({ status: { ...s.status, [sid]: st as SessionStatus } }));
        break;
      }
      case "session.idle": {
        if (!sid) break;
        if (sessionFsm.isBusy(sid)) {
          sessionFsm.resolveIdle(sid);
          // Fix: set idle immediately on session.idle even during send() — was previously breaking without status update
          set((s) => ({
            status: { ...s.status, [sid]: "idle" as SessionStatus },
          }));
          break;
        }
        set((s) => ({
          status: { ...s.status, [sid]: "idle" as SessionStatus },
        }));
        break;
      }
      case "message.removed": {
        const messageID =
          p.messageID ||
          p.message_id ||
          p.messageId ||
          strField(p.message, "id") ||
          "";
        if (!sid || !messageID) break;
        set((s) => ({
          messages: {
            ...s.messages,
            [sid]: (s.messages[sid] ?? []).filter((m) => m.id !== messageID),
          },
        }));
        break;
      }
      case "message.updated": {
        if (!sid) break;
        const msg = p.message as Message | undefined;
        const info = p.info as Record<string, unknown> | undefined;
        if (msg) {
          set((s) => ({
            messages: {
              ...s.messages,
              [sid]: upsertMessage(
                s.messages[sid] ?? [],
                normalizeMessage(msg),
              ),
            },
          }));
          const finish =
            msg?.info?.finish || (msg as { finish?: string })?.finish;
          const completed = msg?.info?.time?.completed;
          if (finish === "stop" || finish === "error" || completed) {
            // Fix Stop button: if message is final (has completed time or finish stop), set idle even during send()
            // Previously it prevented busy reset when locallyBusy, causing Stop to hang 2-4s until http polling
            const isFinal =
              !!completed || finish === "stop" || finish === "error";
            if (isFinal) {
              if (sessionFsm.isBusy(sid)) {
                sessionFsm.resolveIdle(sid);
              }
              set((s) => ({
                status: {
                  ...s.status,
                  [sid]: (finish === "error"
                    ? "error"
                    : "idle") as SessionStatus,
                },
              }));
            } else if (!sessionFsm.isBusy(sid)) {
              // Non-final intermediate finish — only reset if not locallyBusy (preserve old behavior for reasoning stage)
              set((s) => {
                const current = s.status[sid];
                if (current === "busy") {
                  return {
                    status: { ...s.status, [sid]: "idle" as SessionStatus },
                  };
                }
                return {};
              });
            }
          }
        } else if (info?.id) {
          const shell: Message = {
            id: info.id as string,
            role: (info.role as Message["role"]) || "assistant",
            parts: [],
            info: info as Message["info"],
          };
          set((s) => ({
            messages: {
              ...s.messages,
              [sid]: upsertMessage(s.messages[sid] ?? [], shell),
            },
          }));
        }
        break;
      }
      case "message.part.updated": {
        const messageID =
          p.messageID ||
          p.message_id ||
          p.messageId ||
          strField(p.part, "messageID") ||
          strField(p.part, "message_id") ||
          "";
        const part = p.part as Part | undefined;
        if (!sid || !messageID || !part) {
          break;
        }
        set((s) => {
          const updated = patchPart(s.messages[sid] ?? [], messageID, part);
          return { messages: { ...s.messages, [sid]: updated } };
        });
        break;
      }
      case "message.part.delta": {
        const messageID =
          p.messageID ||
          p.message_id ||
          p.messageId ||
          strField(p.part, "messageID") ||
          "";
        const partID =
          p.partID || p.part_id || p.partId || strField(p.part, "id") || "";
        const field = p.field as string | undefined;
        const delta = p.delta;
        if (!sid || !messageID || !partID || !field || delta === undefined) {
          break;
        }
        if (typeof delta === "string") {
          const key = `${sid}\u0000${messageID}\u0000${partID}\u0000${field}`;
          const buf = get()._deltaBuffer;
          const buffered = buf.get(key);
          if (buffered) {
            buffered.text += delta;
          } else {
            buf.set(key, {
              sid,
              messageID,
              partID,
              field,
              text: delta,
            });
          }
          if (!get()._flushTimer) {
            const timer = setTimeout(() => {
              get().flushStreamDeltas();
            }, DELTA_FLUSH_MS);
            set({ _flushTimer: timer });
          }
          break;
        }
        // Не-строковая дельта — досылаем буфер и применяем сразу (порядок!).
        get().flushStreamDeltas();
        set((s) => {
          const updated = patchPartDelta(
            s.messages[sid] ?? [],
            messageID,
            partID,
            field,
            delta,
          );
          return { messages: { ...s.messages, [sid]: updated } };
        });
        break;
      }
      case "stream.corrupted": {
        // P0-fix: битый чанк из стрима — показываем плашку вместо
        // непредсказуемого поведения/белого экрана. Пропущенное
        // содержимое дотянет httpPoller / doFinalFetch.
        set({
          error:
            "Стрим прерван: получен повреждённый фрагмент данных. " +
            "Ответ мог отобразиться не полностью.",
        });
        break;
      }
      case "stream.reconnected": {
        // P1-fix: SSE переподключился после разрыва — события за время
        // разрыва потеряны (нет Last-Event-ID replay). Один раз
        // дотягиваем историю активной сессии и мержим детерминированно.
        const cur = get().currentID;
        if (!cur || cur.startsWith("tmp_")) break;
        void (async () => {
          try {
            const msgs = normalizeMessages(await api.listMessages(cur));
            if (msgs.length === 0) return;
            set((s) => {
              const existing = s.messages[cur] ?? [];
              return {
                messages: {
                  ...s.messages,
                  [cur]: mergeMessagesDeterministic(msgs, existing),
                },
              };
            });
          } catch {
            /* non-fatal — следующий reconnect или поллер дотянет */
          }
        })();
        break;
      }
      case "permission.asked": {
        if (!sid || !p.id) break;
        // Новые версии opencode присылают в `tool` объект-ссылку {messageID, callID},
        // а не имя инструмента. Нормализуем, чтобы React не рендерил объект (error #31).
        const toolName = typeof p.tool === "string" ? p.tool : undefined;
        const req: PermissionRequest = {
          sessionID: sid,
          id: p.id,
          ...(typeof toolName === "string" ? { tool: toolName } : {}),
          input: p.input,
        };
        set((s) => ({
          permissions: s.permissions.some((x) => x.id === req.id)
            ? s.permissions
            : [...s.permissions, req],
        }));
        break;
      }
      case "permission.responded": {
        if (!p.id) break;
        set((s) => ({
          permissions: s.permissions.filter((x) => x.id !== p.id),
        }));
        break;
      }
      default:
        break;
    }
  },
};
};
