import { api } from "../../api/client";
import { normalizeMessages } from "../helpers";
import type { SessionsSlice, Slice } from "../types";
import { byUpdated } from "../types";

// Prevent concurrent optimistic session creation from rapid "New chat" clicks.
let creatingSession = false;

export const createSessionsSlice: Slice<SessionsSlice> = (set, get) => ({
  sessions: [],
  currentID: null,
  status: {},
  permissions: [],
  connection: "connecting",
  serverConnected: null,
  loading: false,
  error: null,
  sessionError: false,

  loadSessions: async () => {
    try {
      const sessions = (await api.listSessions()).sort(byUpdated);
      set({ sessions, sessionError: false, error: null });
    } catch {
      set({ sessionError: true });
    }
  },

  select: async (id) => {
    set({ currentID: id });
    if (!id) return;
    try {
      const msgs = normalizeMessages(await api.listMessages(id));
      set((s) => ({ messages: { ...s.messages, [id]: msgs } }));
    } catch {
      // ignore
    }
  },

  // Claude-like new chat: optimistic, reuse empty, empty workspace, no memory overlap
  newSession: async () => {
    if (creatingSession) return;
    creatingSession = true;

    const { sessions, messages } = get();

    // Check if there's already an empty session (no messages) — like Claude, don't create duplicate empty chats
    const emptySession = sessions.find((s) => {
      const msgs = messages[s.id];
      return !msgs || msgs.length === 0;
    });
    if (emptySession) {
      // Just select existing empty chat instead of creating new one
      set({ currentID: emptySession.id });
      creatingSession = false;
      return;
    }

    // Optimistic creation — show new chat instantly like Claude, without waiting for backend
    const tempId = `tmp_${Date.now()}`;
    const tempSession = {
      id: tempId,
      title: "New chat",
      time: { created: Date.now(), updated: Date.now() },
    } as any;

    set((s) => ({
      sessions: [tempSession, ...s.sessions].sort(byUpdated),
      currentID: tempId,
      messages: { ...s.messages, [tempId]: [] },
      status: { ...s.status, [tempId]: "idle" as any },
    }));

    try {
      // Real creation on backend — backend will create empty workspace /app/workspace/sessions/{id}/workspace
      // Like Claude: new memory, empty workspace, no overlap with other chats
      const session = await api.createSession();
      set((s) => {
        // Replace temp session with real one
        const filtered = s.sessions.filter((x) => x.id !== tempId);
        const msgs = { ...s.messages };
        const tempMsgs = msgs[tempId] || [];
        delete msgs[tempId];
        msgs[session.id] = tempMsgs;
        const st = { ...s.status };
        const tempStatus = st[tempId];
        delete st[tempId];
        if (tempStatus) st[session.id] = tempStatus;
        return {
          sessions: [session, ...filtered].sort(byUpdated),
          currentID: session.id,
          messages: msgs,
          status: st,
        };
      });
    } catch (e) {
      // Rollback optimistic on error
      set((s) => ({
        sessions: s.sessions.filter((x) => x.id !== tempId),
        currentID: s.sessions.find((x) => x.id !== tempId)?.id || null,
        error: (e as Error).message,
      }));
    } finally {
      creatingSession = false;
    }
  },

  // Claude-like delete: delete everything - messages, files, workspace, no recovery
  removeSession: async (id) => {
    // Optimistic delete like Claude — immediately remove from UI
    const prevSessions = get().sessions;
    const prevMessages = get().messages;
    const prevCurrent = get().currentID;

    set((s) => {
      const messages = { ...s.messages };
      delete messages[id];
      return {
        sessions: s.sessions.filter((x) => x.id !== id),
        messages,
        currentID: s.currentID === id ? null : s.currentID,
      };
    });

    try {
      await api.deleteSession(id);
      // Backend deletes:
      // - /app/workspace/sessions/{id} (workspace + uploads)
      // - /app/workspace/uploads/{id} (old path)
      // - ownership record
      // - OpenCode storage (messages, metadata)
      // So like Claude, everything is gone — no overlap, no leftover files
    } catch (e) {
      // Rollback on error
      set({
        sessions: prevSessions,
        messages: prevMessages,
        currentID: prevCurrent,
        error: (e as Error).message,
      });
    }
  },

  abort: async () => {
    const sid = get().currentID;
    if (!sid || sid.startsWith("tmp_")) return;
    try {
      await api.abortSession(sid);
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  respondPermission: async (permissionId, allow) => {
    const req = get().permissions.find((p) => p.id === permissionId);
    if (!req) return;
    set((s) => ({ permissions: s.permissions.filter((p) => p.id !== permissionId) }));
    try {
      await api.respondPermission(req.sessionID, req.id, allow ? "allow" : "deny");
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  setConnection: (connection) => set({ connection }),

  checkConnection: async () => {
    try {
      await api.health();
      set({ serverConnected: true });
    } catch {
      set({ serverConnected: false });
    }
  },
});
