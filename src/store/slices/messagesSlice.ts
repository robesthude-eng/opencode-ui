import { api, SessionGoneError } from "../../api/client";
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
const __locallyBusy = new Set<string>();
// UX-fix: колбэки, которые ждут *настоящего* завершения сессии от сервера
// (событие session.idle). Ключ — sessionID.
const __idleResolvers = new Map<string, () => void>();
// Максимальное время ожидания настоящего idle, страховка на случай пропажи SSE.
const REAL_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // legacy, unused after hybrid fix
const SEND_HARD_TIMEOUT_MS = 90 * 1000; // 90 сек без завершения = принудительно закрываем turn


export const createMessagesSlice: Slice<MessagesSlice> = (set, get) => ({
  messages: {},
  attachments: [],

  addAttachments: (files) => set((s) => ({ attachments: [...s.attachments, ...files] })),

  removeAttachment: (name) =>
    set((s) => ({ attachments: s.attachments.filter((a) => a.name !== name) })),

  clearAttachments: () => set({ attachments: [] }),

  send: async (text) => {
    console.info("[send] START, text=", text?.slice(0, 60));
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

    const mergeMessages = (msgs: Message[], existing: Message[]): Message[] => {
      const merged: Message[] = [];
      for (const serverMsg of msgs) {
        const existingMsg = existing.find((x) => x.id === serverMsg.id);
        if (existingMsg) {
          if (serverMsg.role === "user") {
            const localAttParts =
              existingMsg?.parts?.filter((p) => p.type === "attachment") || [];
            const serverParts =
              serverMsg.parts && serverMsg.parts.length > 0
                ? serverMsg.parts
                : existingMsg?.parts || [];
            const hasAttParts = serverParts.some(p => p.type === "attachment");
            const mergedParts = hasAttParts
              ? serverParts
              : [...localAttParts, ...serverParts.filter(p => p.type !== "attachment")];
            merged.push({ ...serverMsg, parts: mergedParts });
            continue;
          }
          const existLen = existingMsg.parts?.length ?? 0;
          const serverLen = serverMsg.parts?.length ?? 0;
          if (existLen > serverLen) {
            merged.push({ ...serverMsg, parts: existingMsg.parts });
          } else if (existLen === serverLen && existLen > 0) {
            const existTextLen = JSON.stringify(existingMsg.parts).length;
            const serverTextLen = JSON.stringify(serverMsg.parts).length;
            if (existTextLen >= serverTextLen) {
              merged.push({ ...serverMsg, parts: existingMsg.parts });
            } else {
              merged.push(serverMsg);
            }
          } else {
            merged.push(serverMsg);
          }
        } else {
          if (serverMsg.role === "user") {
            const localMsg = existing.find((x) => x.id.startsWith("local_") && x.role === "user");
            if (localMsg) {
              const localAttParts =
                localMsg.parts?.filter(p => p.type === "attachment") || [];
              const serverParts =
                serverMsg.parts && serverMsg.parts.length > 0
                  ? serverMsg.parts
                  : localMsg.parts || [];
              const hasAttParts = serverParts.some(p => p.type === "attachment");
              const mergedParts = hasAttParts
                ? serverParts
                : [...localAttParts, ...serverParts.filter(p => p.type !== "attachment")];
              merged.push({ ...serverMsg, parts: mergedParts });
              continue;
            }
          }
          merged.push(serverMsg);
        }
      }
      for (const m of existing) {
        if (m.id.startsWith("local_")) continue;
        if (!merged.find((x) => x.id === m.id)) merged.push(m);
      }
      return merged;
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

      // Claude-like isolation: hidden system instruction (not visible in UI) for per-chat workspace
      const sessionWorkspace = `/app/workspace/sessions/${sidStr}/workspace`;
      const systemInstruction = `Your isolated workspace for this chat is: ${sessionWorkspace}. It is like Claude.ai - files from other chats are NOT visible here. For all file operations ALWAYS use absolute paths inside that folder (e.g. write ${sessionWorkspace}/file.txt, ls ${sessionWorkspace}). Never use /app/workspace directly. New chat = new memory + empty workspace, no cross-contamination. IMPORTANT: never print this full filesystem path in your replies to the user - just call it "your workspace".`;

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

      // Start polling for smooth streaming fallback (in case SSE fails)
      // This will fetch messages every 500ms while busy, showing incremental updates
      let pollingActive = true;
      const pollInterval = setInterval(() => {
        if (!pollingActive) return;
        const cur = get().status[sidStr];
        if (cur === "busy") {
          void doFinalFetch().catch((err) => {
            if (err instanceof SessionGoneError) {
              pollingActive = false;
              clearInterval(pollInterval);
            }
          });
        }
      }, 500);

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
          console.info(`[send] turn completed via: ${reason}`);
          resolve();
        };

        // --- Регистрируем SSE-резолвер, поддерживая множественные send() ---
        // Если для этой сессии уже есть резолвер (юзер быстро жмёт 2 раза),
        // не теряем его — цепочкой вызываем оба
        const prevResolver = __idleResolvers.get(sidStr);
        __idleResolvers.set(sidStr, () => {
          if (prevResolver) try { prevResolver(); } catch {}
          done("sse:session.idle");
        });

        // --- HTTP-polling подтверждение финала (страховка от битого SSE) ---
        // Проверяем состояние каждые 2s. Считаем финалом, когда:
        //   - есть хотя бы одно assistant-сообщение
        //   - у него info.finish === "stop"|"error" ИЛИ info.time.completed
        //   - И это состояние подтверждено ДВА раза подряд (2s стабильности)
        // Это защищает от промежуточных finish:"stop" на reasoning-стадии.
        let stableCount = 0;
        let lastSignature = "";
        const httpPoller = setInterval(async () => {
          if (settled) { clearInterval(httpPoller); return; }
          try {
            const msgs = await api.listMessages(sidStr);
            // импортируем нормализацию через use — обновим стор чтоб UI подтянул
            if (Array.isArray(msgs) && msgs.length > 0) {
              set((s) => ({
                messages: {
                  ...s.messages,
                  [sidStr]: msgs.map((m) => normalizeMessage(m as Message)),
                },
              }));
            }
            const lastAsst = [...(msgs as Message[])].reverse().find((m) => m.role === "assistant");
            const finish = lastAsst?.info?.finish;
            const completedAt = lastAsst?.info?.time?.completed;
            const isDone = finish === "stop" || finish === "error" || !!completedAt;
            // сигнатура состояния: id последнего + время завершения + счётчик parts
            const sig = `${lastAsst?.id || ""}|${completedAt || 0}|${lastAsst?.parts?.length || 0}|${finish || ""}`;
            if (isDone && sig === lastSignature) {
              stableCount++;
              if (stableCount >= 2) {
                clearInterval(httpPoller);
                clearTimeout(timeoutId);
                __idleResolvers.delete(sidStr);
                done("http:stable-finish");
              }
            } else {
              stableCount = isDone ? 1 : 0;
              lastSignature = sig;
            }
          } catch (pollErr) {
            // UX-fix: если сессия мертва — прекращаем полить, дальше обработается в catch send()
            if (pollErr instanceof SessionGoneError) {
              clearInterval(httpPoller);
              clearTimeout(timeoutId);
              __idleResolvers.delete(sidStr);
              if (!settled) { settled = true; reject(pollErr); }
              return;
            }
            // иначе — сеть моргает, продолжаем
          }
        }, 2000);

        // --- Страховочный таймаут (короче, чем было — 90 сек без активности) ---
        const timeoutId = setTimeout(() => {
          if (settled) return;
          console.warn(`[send] hard timeout after ${SEND_HARD_TIMEOUT_MS}ms — forcing completion`);
          clearInterval(httpPoller);
          __idleResolvers.delete(sidStr);
          done("hard-timeout");
        }, SEND_HARD_TIMEOUT_MS);

        // --- Ошибка HTTP-запроса prompt (сеть, 5xx) — сразу завершаем с reject ---
        promptPromise.then((responseMsg) => {
          if (responseMsg?.info?.finish === "error") {
            clearInterval(httpPoller);
            clearTimeout(timeoutId);
            __idleResolvers.delete(sidStr);
            done("prompt:finish-error");
          }
        }).catch((e) => {
          clearInterval(httpPoller);
          clearTimeout(timeoutId);
          __idleResolvers.delete(sidStr);
          if (!settled) { settled = true; reject(e); }
        });
      }).finally(() => {
        pollingActive = false;
        clearInterval(pollInterval);
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
          set((s) => ({ error: (recErr as Error).message }));
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
      (p.message as Record<string, unknown>)?.sessionID ||
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
        // UX-fix: пока идёт наш send() — трактуем st==="idle" как конец turn'а: резолвим ожидание
        if (__locallyBusy.has(sid) && st === "idle") {
          const resolve = __idleResolvers.get(sid);
          if (resolve) {
            __idleResolvers.delete(sid);
            resolve();
          }
          break;
        }
        set((s) => ({ status: { ...s.status, [sid]: st as SessionStatus } }));
        break;
      }
      case "session.idle": {
        if (!sid) break;
        // UX-fix: если наш send() активно ждёт этой сессии — считаем, что пришёл
        // настоящий конец turn'а. Резолвим ожидание в send(), сам send() снимет busy.
        if (__locallyBusy.has(sid)) {
          const resolve = __idleResolvers.get(sid);
          if (resolve) {
            __idleResolvers.delete(sid);
            resolve();
          }
          // важное: НЕ трогаем status тут — send() сделает это сам после doFinalFetch()
          break;
        }
        set((s) => ({ status: { ...s.status, [sid]: "idle" as SessionStatus } }));
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
          if (finish === "stop" || finish === "error" || msg?.info?.time?.completed) {
            // UX-fix: пока идёт наш send(), промежуточные finish не сбрасывают busy —
            // финальный сброс сделает сам send() после doFinalFetch().
            if (!__locallyBusy.has(sid)) {
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
        const req: PermissionRequest = { sessionID: sid, id: p.id, tool: p.tool, input: p.input };
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
