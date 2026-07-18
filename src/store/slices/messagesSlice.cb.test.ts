// Релиз 5: тесты Circuit Breaker (Релиз 2): не более CB_MAX_TOOL_CALLS
// завершённых tool-вызовов без участия пользователя, затем trip + abort;
// cbResume и участие пользователя сбрасывают счётчик.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { AppEvent, SessionInfo } from "../../api/types";
import type { State } from "../types";
import {
  CB_MAX_TOOL_CALLS,
  cbUserParticipated,
  createMessagesSlice,
} from "./messagesSlice";

type Store = State & ReturnType<typeof createMessagesSlice>;

function makeStore(initial: Partial<Store> = {}) {
  const store = {
    sessions: [],
    status: {},
    permissions: [],
    messages: {},
    attachments: [],
    ...initial,
  } as Store;
  const set = (update: unknown) => {
    const next = typeof update === "function" ? update(store) : update;
    Object.assign(store, next);
  };
  const slice = createMessagesSlice(
    set as never,
    (() => store) as never,
    {} as never,
  );
  Object.assign(store, slice, initial);
  return store;
}

function toolPart(sid: string, partId: string, status: string): AppEvent {
  return {
    type: "message.part.updated",
    properties: {
      sessionID: sid,
      messageID: "msg_1",
      part: {
        id: partId,
        messageID: "msg_1",
        type: "tool",
        callID: `call_${partId}`,
        state: { status },
      },
    },
  } as unknown as AppEvent;
}

const toolCompleted = (sid: string, partId: string) =>
  toolPart(sid, partId, "completed");

describe("Circuit Breaker", () => {
  let abortSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    abortSpy = vi
      .spyOn(api, "abortSession")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Счётчики CB — модульное состояние, поэтому каждому тесту — свой sid
  // и явный сброс через cbUserParticipated.
  function freshStore(sid: string) {
    cbUserParticipated(sid);
    return makeStore({
      currentID: sid,
      messages: { [sid]: [] },
      sessions: [{ id: sid, title: "CB", time: { updated: 1 } } as SessionInfo],
      send: vi.fn().mockResolvedValue(undefined) as never,
    });
  }

  it("не срабатывает до порога", () => {
    const sid = "ses_cb_below";
    const store = freshStore(sid);
    for (let i = 1; i < CB_MAX_TOOL_CALLS; i++) {
      store.applyEvent(toolCompleted(sid, `tp_${i}`));
    }
    expect(store.cbTripped[sid]).toBeFalsy();
    expect(abortSpy).not.toHaveBeenCalled();
  });

  it("на пороговом завершённом вызове — trip + останов сессии", () => {
    const sid = "ses_cb_trip";
    const store = freshStore(sid);
    for (let i = 1; i <= CB_MAX_TOOL_CALLS; i++) {
      store.applyEvent(toolCompleted(sid, `tp_${i}`));
    }
    expect(store.cbTripped[sid]).toBe(true);
    expect(abortSpy).toHaveBeenCalledWith(sid);
    expect(abortSpy).toHaveBeenCalledTimes(1);
  });

  it("один и тот же part не считается дважды (идемпотентность по partKey)", () => {
    const sid = "ses_cb_dup";
    const store = freshStore(sid);
    for (let i = 0; i < CB_MAX_TOOL_CALLS + 3; i++) {
      store.applyEvent(toolCompleted(sid, "tp_same"));
    }
    expect(store.cbTripped[sid]).toBeFalsy();
    expect(abortSpy).not.toHaveBeenCalled();
  });

  it("pending/running не считаются — только completed/error", () => {
    const sid = "ses_cb_running";
    const store = freshStore(sid);
    for (let i = 1; i <= CB_MAX_TOOL_CALLS; i++) {
      store.applyEvent(toolPart(sid, `tp_${i}`, "running"));
    }
    expect(store.cbTripped[sid]).toBeFalsy();
  });

  it("error-статус тоже считается завершением вызова", () => {
    const sid = "ses_cb_error";
    const store = freshStore(sid);
    for (let i = 1; i <= CB_MAX_TOOL_CALLS; i++) {
      store.applyEvent(toolPart(sid, `tp_${i}`, "error"));
    }
    expect(store.cbTripped[sid]).toBe(true);
  });

  it("участие пользователя сбрасывает счётчик", () => {
    const sid = "ses_cb_user";
    const store = freshStore(sid);
    for (let i = 1; i < CB_MAX_TOOL_CALLS; i++) {
      store.applyEvent(toolCompleted(sid, `tp_${i}`));
    }
    cbUserParticipated(sid); // пользователь отправил сообщение
    store.applyEvent(toolCompleted(sid, "tp_after_user"));
    expect(store.cbTripped[sid]).toBeFalsy();
    expect(abortSpy).not.toHaveBeenCalled();
  });

  it("cbResume: сбрасывает флаг и продолжает работу новым промптом", () => {
    const sid = "ses_cb_resume";
    const store = freshStore(sid);
    for (let i = 1; i <= CB_MAX_TOOL_CALLS; i++) {
      store.applyEvent(toolCompleted(sid, `tp_${i}`));
    }
    expect(store.cbTripped[sid]).toBe(true);
    store.cbResume(sid);
    expect(store.cbTripped[sid]).toBe(false);
    expect(store.send).toHaveBeenCalledWith("Продолжай выполнение задачи.");
    // после resume порог отсчитывается заново
    store.applyEvent(toolCompleted(sid, "tp_new"));
    expect(store.cbTripped[sid]).toBe(false);
  });
});
