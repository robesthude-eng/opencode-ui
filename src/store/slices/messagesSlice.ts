import { api } from "../../api/client";
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
      path: (a as any).uploadedPath || undefined,
      dataUrl: a.dataUrl || undefined,
    }));

    const userMsg: Message = {
      id: `local_${Date.now()}`,
      role: "user",
      parts: [...attachmentParts, { type: "text", text }],
    };
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
              existingMsg?.parts?.filter((p: any) => p.type === "attachment") || [];
            const serverParts =
              serverMsg.parts && serverMsg.parts.length > 0
                ? serverMsg.parts
                : existingMsg?.parts || [];
            const hasAttParts = serverParts.some((p: any) => p.type === "attachment");
            const mergedParts = hasAttParts
              ? serverParts
              : [...localAttParts, ...serverParts.filter((p: any) => p.type !== "attachment")];
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
                localMsg.parts?.filter((p: any) => p.type === "attachment") || [];
              const serverParts =
                serverMsg.parts && serverMsg.parts.length > 0
                  ? serverMsg.parts
                  : localMsg.parts || [];
              const hasAttParts = serverParts.some((p: any) => p.type === "attachment");
              const mergedParts = hasAttParts
                ? serverParts
                : [...localAttParts, ...serverParts.filter((p: any) => p.type !== "attachment")];
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
        const path = (att as any).uploadedPath;
        const entryCount = (att as any).entryCount;
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
          void doFinalFetch();
        }
      }, 500);

      const responseMsg = await api.promptWithParts(
        sidStr,
        parts,
        selectedModel ?? undefined,
        systemInstruction,
      );

      const isFinished =
        (responseMsg as any)?.info?.finish === "stop" ||
        (responseMsg as any)?.info?.finish === "error" ||
        !!(responseMsg as any)?.info?.time?.completed;

      await new Promise<void>((resolve) => {
        let elapsed = 0;
        const maxWait = isFinished ? 3000 : 30000;
        const id = setInterval(() => {
          elapsed += 250;
          const cur = get().status[sidStr];
          const msgs = get().messages[sidStr] ?? [];
          const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
          const lastFinished =
            !!(lastAssistant as any)?.info?.finish ||
            !!(lastAssistant as any)?.info?.time?.completed;

          if (cur && cur !== "busy") {
            clearInterval(id);
            pollingActive = false;
            clearInterval(pollInterval);
            resolve();
          } else if (lastFinished && elapsed > 1000) {
            clearInterval(id);
            pollingActive = false;
            clearInterval(pollInterval);
            resolve();
          } else if (elapsed >= maxWait) {
            console.warn(`[Chat] Status still busy after ${maxWait}ms, forcing idle (fallback)`);
            clearInterval(id);
            pollingActive = false;
            clearInterval(pollInterval);
            resolve();
          }
          // Note: polling already does fetch every 500ms, no need extra 5s fetch
        }, 250);
      });
      clearInterval(pollInterval);
      pollingActive = false;
      set({ attachments: [] });
    } catch (e) {
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
        set((s) => ({ status: { ...s.status, [sid]: st as SessionStatus } }));
        break;
      }
      case "session.idle": {
        if (!sid) break;
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
          const finish = (msg as any)?.info?.finish || (msg as any)?.finish;
          if (finish === "stop" || finish === "error" || (msg as any)?.info?.time?.completed) {
            set((s) => {
              const current = s.status[sid];
              if (current === "busy") {
                return { status: { ...s.status, [sid]: "idle" as SessionStatus } };
              }
              return {};
            });
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
