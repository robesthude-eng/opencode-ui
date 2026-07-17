import { api, SessionGoneError } from "../../api/client";
import { mergeMessages as mergeMessagesDeterministic } from "../../api/messageMerge";
import type { Message, Part, PermissionRequest, SessionInfo, SessionStatus } from "../../api/types";
import {
  normalizeMessage,
  normalizeMessages,
  patchPart,
  patchPartDelta,
  upsertMessage,
} from "../helpers";
import type { MessagesSlice, Slice } from "../types";
import { byUpdated } from "../types";

// UX-fix: пока клиент активно ждёт ответа на свой send(), запрещаем
// сбрасывать busy по промежуточным событиям (finish:"stop" на reasoning-стадии,
// session.idle между tool-calls). Ключ — sessionID.
// P0.4 FSM: moved to sessionFsm.ts but kept here for backward compat until fully migrated
const __locallyBusy = new Set<string>();
// UX-fix: колбэки, которые ждут *настоящего* завершения сессии от сервера
// (событие session.idle). Ключ — sessionID.
const __idleResolvers = new Map<string, () => void>();
// Safety watchdog only; normal completion comes from SSE session.idle,
// the final prompt response, or HTTP reconciliation. Keep it longer than
// ordinary multi-tool self-improvement runs to avoid false completion.
const SEND_HARD_TIMEOUT_MS = 15 * 60 * 1000; // 15 min safety limit

export const createMessagesSlice: Slice<MessagesSlice> = (set, get) => ({
  messages: {},
  attachments: [],

  addAttachments: (files) => set((s) => ({ attachments: [...s.attachments, ...files] })),

  removeAttachment: (name) =>
    set((s) => ({ attachments: s.attachments.filter((a) => a.name !== name) })),

  clearAttachments: () => set({ attachments: [] }),

  send: async (text) => {
    const { currentID, newSession, selectedModel } = get();
    let sid = currentID;
    // Handle tmp_ optimistic IDs — wait for real session or create new one (Claude-like)
    if (!sid || sid.startsWith("tmp_")) {
      if (sid?.startsWith("tmp_")) {
        // If we have a temp ID, wait a bit for real ID to appear (optimistic creation in progress)
        // Like Claude, don't send to temp ID, wait for real session
        await new Promise((r) => setTimeout(r, 300));
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
    const attachmentParts: Part[] = currentAttachments.map((a) => ({
      type: "attachment" as const,
      name: a.name,
      size: a.size,
      kind: a.kind,
      path: a.uploadedPath || undefined,
      dataUrl: a.dataUrl || undefined,
    }));

    const userMsg: Message = {
      id: `local_${Date.now()}`,
      role: "user",
      parts: [...attachmentParts, { type: "text", text }],
    };
    __locallyBusy.add(sidStr);
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
      const attachments = get().attachments;
      const parts: Record<string, unknown>[] = [];
      let promptText = text;

      // P1.1 — Remove client duplication of server workspace path after spike succeeds
      // Server isolation via ?directory= already provides per-session workspace, no need to leak absolute path in prompt
      // Keep generic instruction without absolute path to avoid cross-contamination, but don't expose /app/workspace structure
      const systemInstruction = `You are in an isolated workspace for this chat, like Claude.ai. Files from other chats are NOT visible. Never use absolute paths from other chats. New chat = new memory + empty workspace.`;

      for (const att of attachments) {
        const path = att.uploadedPath;
        const entryCount = att.entryCount;
        if (att.kind === "zip" && path) {
          const hint = typeof entryCount === "number" ? ` (${entryCount} файлов внутри)` : "";
          promptText += `\n\n📎 ${att.name} → ${path}${hint} — это zip-архив, ещё не распакован`;
          continue;
        }
        if (att.part) parts.push(att.part);
        else if (att.textPart) parts.push(att.textPart);
      }
      parts.push({ type: "text", text: promptText });

      // Fire-and-forget prompt: сервер сам стримит события через SSE.
      // Не полагаемся на возврат promptWithParts как индикатор финиша —
      // ждём ЛИБО session.idle из SSE, ЛИБО подтверждённый через HTTP-polling
      // финал (два опроса подряд показывают одинаковое finish + отсутствие новых сообщений).
      // Это защищает от нестабильного SSE (мобильная сеть, VPN).
      const promptPromise = api.promptWithParts(
        sidStr,
        parts,
        selectedModel ?? undefined,
        systemInstruction,
      );

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const done = (reason: string) => {
          if (settled) return;
          settled = true;
          resolve();
        };

        // --- Регистрируем SSE-резолвер, поддерживая множественные send() ---
        // Если для этой сессии уже есть резолвер (юзер быстро жмёт 2 раза),
        // не теряем его — цепочкой вызываем оба
        const prevResolver = __idleResolvers.get(sidStr);
        __idleResolvers.set(sidStr, () => {
          if (prevResolver)
            try {
              prevResolver();
            } catch {}
          done("sse:session.idle");
        });

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
            if (Array.isArray(msgs) && msgs.length > 0) {
              set((s) => {
                const existing = s.messages[sidStr] ?? [];
                const merged = mergeMessages(normalizeMessages(msgs as Message[]), existing);
                return { messages: { ...s.messages, [sidStr]: merged } };
              });
            }
            const lastAsst = [...(msgs as Message[])].reverse().find((m) => m.role === "assistant");
            const finish = lastAsst?.info?.finish;
            const completedAt = lastAsst?.info?.time?.completed;
            const isDone = finish === "stop" || finish === "error" || !!completedAt;
            // сигнатура состояния: id последнего + время завершения + счётчик parts
            const sig = `${lastAsst?.id || ""}|${completedAt || 0}|${lastAsst?.parts?.length || 0}|${finish || ""}`;
            if (isDone && sig === lastSignature) {
              stableCount++;
              if (stableCount >= 1) {
                clearInterval(httpPoller);
                clearTimeout(timeoutId);
                __idleResolvers.delete(sidStr);
                done("http:stable-finish");
              }
            } else {
              stableCount = isDone ? 1 : 0;
              lastSignature = sig;
              // Fix Stop button hang: if we have completedAt (final message), finish immediately without waiting for second poll
              if (isDone && completedAt) {
                clearInterval(httpPoller);
                clearTimeout(timeoutId);
                __idleResolvers.delete(sidStr);
                done("http:completed-immediate");
              }
            }
          } catch (pollErr) {
            // UX-fix: если сессия мертва — прекращаем полить, дальше обработается в catch send()
            if (pollErr instanceof SessionGoneError) {
              clearInterval(httpPoller);
              clearTimeout(timeoutId);
              __idleResolvers.delete(sidStr);
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
          console.warn(`[send] hard timeout after ${SEND_HARD_TIMEOUT_MS}ms — forcing completion`);
          clearInterval(httpPoller);
          __idleResolvers.delete(sidStr);
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
              __idleResolvers.delete(sidStr);
              done(finish === "error" ? "prompt:finish-error" : "prompt:finish-stop");
            }
          })
          .catch((e) => {
            clearInterval(httpPoller);
            clearTimeout(timeoutId);
            __idleResolvers.delete(sidStr);
            if (!settled) {
              settled = true;
              reject(e);
            }
          });
      }).finally(() => {
        // no extra poll interval
      });
      set({ attachments: [] });
    } catch (e) {
      __locallyBusy.delete(sidStr);
      if (e instanceof SessionGoneError) {
        console.warn("[send] session gone on backend, recreating:", e.sessionId);
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
            void get().send(text);
          }
        } catch (recErr) {
          set((_s) => ({ error: (recErr as Error).message }));
        }
        return;
      }
      set((s) => ({
        error: (e as Error).message,
        status: { ...s.status, [sidStr]: "error" },
        messages: {
          ...s.messages,
          [sidStr]: (s.messages[sidStr] ?? []).filter((m) => m.id !== userMsg.id),
        },
      }));
      return;
    }

    await doFinalFetch();
    set((s) => {
      const currentStatus = s.status[sidStr];
      __locallyBusy.delete(sidStr);
      const finalStatus: SessionStatus = currentStatus === "error" ? "error" : "idle";
      return {
        status: { ...s.status, [sidStr]: finalStatus },
      };
    });
  },

  applyEvent: (e) => {
    const p = e.properties;
    const sid = (p.sessionID ||
      p.session_id ||
      p.sessionId ||
      (p.part as Record<string, unknown>)?.sessionID ||
      (p.info as Record<string, unknown>)?.sessionID ||
      (p.message as any)?.sessionID ||
      "") as string;

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
        const st =
          typeof p.status === "string" ? p.status : (p.status as { type?: string }).type || "idle";
        // Fix Stop button hang: when locallyBusy and st===idle (real end), resolve AND set idle immediately
        // Previously it only resolved and broke without setting status, causing Stop to hang until http polling stable
        if (__locallyBusy.has(sid) && st === "idle") {
          const resolve = __idleResolvers.get(sid);
          if (resolve) {
            __idleResolvers.delete(sid);
            resolve();
          }
          // P0.4: Set idle immediately, not waiting for http polling
          set((s) => ({ status: { ...s.status, [sid]: "idle" as SessionStatus } }));
          break;
        }
        set((s) => ({ status: { ...s.status, [sid]: st as SessionStatus } }));
        break;
      }
      case "session.idle": {
        if (!sid) break;
        if (__locallyBusy.has(sid)) {
          const resolve = __idleResolvers.get(sid);
          if (resolve) {
            __idleResolvers.delete(sid);
            resolve();
          }
          // Fix: set idle immediately on session.idle even during send() — was previously breaking without status update
          set((s) => ({ status: { ...s.status, [sid]: "idle" as SessionStatus } }));
          break;
        }
        set((s) => ({ status: { ...s.status, [sid]: "idle" as SessionStatus } }));
        break;
      }
      case "message.removed": {
        const messageID = (p.messageID ||
          p.message_id ||
          p.messageId ||
          (p.message as any)?.id ||
          "") as string;
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
              [sid]: upsertMessage(s.messages[sid] ?? [], normalizeMessage(msg)),
            },
          }));
          const finish = msg?.info?.finish || (msg as { finish?: string })?.finish;
          const completed = msg?.info?.time?.completed;
          if (finish === "stop" || finish === "error" || completed) {
            // Fix Stop button: if message is final (has completed time or finish stop), set idle even during send()
            // Previously it prevented busy reset when locallyBusy, causing Stop to hang 2-4s until http polling
            const isFinal = !!completed || finish === "stop" || finish === "error";
            if (isFinal) {
              const resolve = __idleResolvers.get(sid);
              if (__locallyBusy.has(sid) && resolve) {
                __idleResolvers.delete(sid);
                resolve();
              }
              set((s) => ({
                status: {
                  ...s.status,
                  [sid]: (finish === "error" ? "error" : "idle") as SessionStatus,
                },
              }));
            } else if (!__locallyBusy.has(sid)) {
              // Non-final intermediate finish — only reset if not locallyBusy (preserve old behavior for reasoning stage)
              set((s) => {
                const current = s.status[sid];
                if (current === "busy") {
                  return { status: { ...s.status, [sid]: "idle" as SessionStatus } };
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
            messages: { ...s.messages, [sid]: upsertMessage(s.messages[sid] ?? [], shell) },
          }));
        }
        break;
      }
      case "message.part.updated": {
        const messageID = (p.messageID ||
          p.message_id ||
          p.messageId ||
          (p.part as Record<string, unknown>)?.messageID ||
          (p.part as Record<string, unknown>)?.message_id ||
          "") as string;
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
        const messageID = (p.messageID ||
          p.message_id ||
          p.messageId ||
          (p.part as Record<string, unknown>)?.messageID ||
          "") as string;
        const partID = (p.partID ||
          p.part_id ||
          p.partId ||
          (p.part as Record<string, unknown>)?.id ||
          "") as string;
        const field = p.field as string | undefined;
        const delta = p.delta;
        if (!sid || !messageID || !partID || !field || delta === undefined) {
          break;
        }
        set((s) => {
          const updated = patchPartDelta(s.messages[sid] ?? [], messageID, partID, field, delta);
          return { messages: { ...s.messages, [sid]: updated } };
        });
        break;
      }
      case "permission.asked": {
        if (!sid || !p.id) break;
        // Новые версии opencode присылают в `tool` объект-ссылку {messageID, callID},
        // а не имя инструмента. Нормализуем, чтобы React не рендерил объект (error #31).
        const toolName = typeof p.tool === "string" ? p.tool : undefined;
        const req: PermissionRequest = { sessionID: sid, id: p.id, tool: toolName, input: p.input };
        set((s) => ({
          permissions: s.permissions.some((x) => x.id === req.id)
            ? s.permissions
            : [...s.permissions, req],
        }));
        break;
      }
      case "permission.responded": {
        if (!p.id) break;
        set((s) => ({ permissions: s.permissions.filter((x) => x.id !== p.id) }));
        break;
      }
      default:
        break;
    }
  },
});
