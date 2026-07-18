import { api, isSessionDead, SessionGoneError } from "../../api/client";
import type { SessionInfo, SessionStatus } from "../../api/types";
import { normalizeMessages } from "../helpers";
import type { SessionsSlice, Slice } from "../types";
import { byUpdated } from "../types";
// Циклический импорт с messagesSlice безопасен: cbUserParticipated —
// хойстируемая function-декларация, вызывается только в рантайме.
import { cbUserParticipated } from "./messagesSlice";

// Prevent concurrent optimistic session creation from rapid "New chat" clicks.
let creatingSession = false;

// Settles when the in-flight newSession() finishes: either the real session
// id is already in the store or the optimistic tmp_ session was rolled back.
// send() awaits this event instead of napping a fixed 300ms and hoping the
// backend is fast enough.
let sessionCreationSettled: Promise<void> = Promise.resolve();
let settleSessionCreation: () => void = () => {};

/** Wait until the in-flight optimistic session creation (if any) settles. */
export function waitForSessionCreation(): Promise<void> {
  return sessionCreationSettled;
}

// UX-fix: чтобы React StrictMode / URL-effect не делали 3 select() подряд
// с уходом в сеть, помним какие sid мы уже начинали проверять.
// Комбо с __deadSessions в client.ts даёт полное подавление флудa 410.
const __pendingSelect = new Set<string>();
function _cleanupGhostFromURL(sid: string) {
  if (typeof window === "undefined") return;
  if (window.location.pathname.includes(sid)) {
    window.history.replaceState({}, "", "/");
  }
}

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
    // UX-fix: если sid уже в blacklist (сервер вернул 410 в прошлом запросе) —
    // не идём в сеть повторно. Просто чистим URL и переключаемся на первую живую.
    if (id && isSessionDead(id)) {
      console.warn(
        "[select] sid уже помечен dead, пропускаем сетевой вызов:",
        id,
      );
      set((state) => {
        const messages = { ...state.messages };
        delete messages[id];
        const remaining = state.sessions.filter((x) => x.id !== id);
        const nextId = remaining[0]?.id ?? null;
        return { sessions: remaining, messages, currentID: nextId };
      });
      _cleanupGhostFromURL(id);
      return;
    }

    // UX-fix: защита от React StrictMode double-invoke и от URL↔store loop —
    // если select(id) уже в полёте, не запускаем второй параллельно.
    if (id && __pendingSelect.has(id)) {
      set({ currentID: id });
      return;
    }
    if (id) __pendingSelect.add(id);

    set({ currentID: id });
    if (!id) return;
    try {
      const msgs = normalizeMessages(await api.listMessages(id));
      set((s) => ({ messages: { ...s.messages, [id]: msgs } }));
    } catch (e) {
      // UX-fix: если сессия мёртвая — убираем её из стора и переключаемся
      if (e instanceof SessionGoneError) {
        console.warn("[select] session gone, cleaning up:", id);
        set((state) => {
          const messages = { ...state.messages };
          delete messages[id];
          const remaining = state.sessions.filter((x) => x.id !== id);
          const nextId = remaining[0]?.id ?? null;
          return {
            sessions: remaining,
            messages,
            currentID: nextId,
          };
        });
        _cleanupGhostFromURL(id);
      }
    } finally {
      if (id) __pendingSelect.delete(id);
    }
  },

  // Claude-like new chat: optimistic, empty workspace, no memory overlap.
  // P2-fix: убрана эвристика переиспользования «пустых» сессий: после
  // перезагрузки страницы messages ещё не подгружены ни для одной
  // сессии, поэтому «пустой» выглядела любая старая сессия и
  // «New chat» молча открывал старый чат вместо нового.
  newSession: async () => {
    if (creatingSession) return;
    creatingSession = true;
    sessionCreationSettled = new Promise((resolve) => {
      settleSessionCreation = resolve;
    });

    // Optimistic creation — show new chat instantly like Claude, without waiting for backend
    const tempId = `tmp_${Date.now()}`;
    const tempSession: SessionInfo = {
      id: tempId,
      title: "New chat",
      time: { created: Date.now(), updated: Date.now() },
    };

    set((s) => ({
      sessions: [tempSession, ...s.sessions].sort(byUpdated),
      currentID: tempId,
      messages: { ...s.messages, [tempId]: [] },
      status: { ...s.status, [tempId]: "idle" as SessionStatus },
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
      settleSessionCreation();
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
      // If we just removed the dedicated Self-Improvement chat, clear its marker
      // (both client-side and on the server) so it can be re-created cleanly.
      if (get().selfImproveSessionId === id) {
        get().setSelfImproveSessionId(null);
        try {
          await api.setSelfImproveSession("");
        } catch {
          /* best-effort */
        }
      }
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

  // OpenCode 1.18+ permission response enum:
  //  - "once":   allow this single tool call (the safe default; maps to old "allow")
  //  - "always": allow every similar call until the session ends
  //  - "reject": deny the call (maps to old "deny")
  respondPermission: async (permissionId, response) => {
    const req = get().permissions.find((p) => p.id === permissionId);
    if (!req) return;
    // Ответ на permission — участие пользователя: сбрасываем Circuit Breaker.
    cbUserParticipated(req.sessionID);
    set((s) => ({
      permissions: s.permissions.filter((p) => p.id !== permissionId),
    }));
    try {
      await api.respondPermission(req.sessionID, req.id, response);
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  // Auto-create (once) the dedicated «Самоулучшение» chat when Self-Improvement is
  // enabled, and select it so the user can immediately drive the agent. Reuses an
  // existing self-improve session (by stored id, then by title) to avoid duplicates.
  ensureSelfImproveSession: async () => {
    const SELF_IMPROVE_TITLE = "Самоулучшение";
    const {
      sessions,
      currentID,
      selfImproveSessionId,
      setSelfImproveSessionId,
    } = get();

    // Persist the designated chat on the server so its agent is pointed at the
    // live project source. Best-effort: a failure here only means the agent won't
    // get project access until the next toggle.
    const persistSiSession = async (id: string) => {
      try {
        await api.setSelfImproveSession(id);
      } catch {
        /* best-effort */
      }
    };

    const existing =
      (selfImproveSessionId &&
        sessions.find((s) => s.id === selfImproveSessionId)) ||
      sessions.find((s) => s.title === SELF_IMPROVE_TITLE);
    if (existing) {
      setSelfImproveSessionId(existing.id);
      void persistSiSession(existing.id);
      if (currentID !== existing.id) await get().select(existing.id);
      return existing.id;
    }

    try {
      const session = await api.createSession(SELF_IMPROVE_TITLE);
      setSelfImproveSessionId(session.id);
      set((s) => ({
        sessions: [session, ...s.sessions].sort(byUpdated),
        currentID: session.id,
        messages: { ...s.messages, [session.id]: s.messages[session.id] || [] },
        status: { ...s.status, [session.id]: "idle" as SessionStatus },
      }));
      await get().select(session.id);
      void persistSiSession(session.id);
      return session.id;
    } catch (e) {
      set({ error: (e as Error).message });
      return null;
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
