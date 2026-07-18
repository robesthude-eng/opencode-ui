// Релиз 5: тесты optimistic-удаления сессии и функционального отката
// (Релиз 4, батч 1): откат не должен затирать состояние, пришедшее по SSE
// за время ожидания ответа сервера.
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { SessionInfo } from "../../api/types";
import type { State } from "../types";
import { createSessionsSlice } from "./sessionsSlice";

type Store = State & ReturnType<typeof createSessionsSlice>;

const ses = (id: string, updated: number): SessionInfo =>
  ({ id, title: id, time: { updated } }) as SessionInfo;

function makeStore(initial: Partial<Store> = {}) {
  const store = {
    sessions: [],
    status: {},
    permissions: [],
    messages: {},
    attachments: [],
    selfImproveSessionId: null,
    setSelfImproveSessionId: vi.fn(),
    ...initial,
  } as unknown as Store;
  const set = (update: unknown) => {
    const next = typeof update === "function" ? update(store) : update;
    Object.assign(store, next);
  };
  const slice = createSessionsSlice(
    set as never,
    (() => store) as never,
    {} as never,
  );
  Object.assign(store, slice, initial);
  return store;
}

describe("removeSession: optimistic delete + откат", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("сразу убирает сессию из UI и зовёт deleteSession", async () => {
    const del = vi
      .spyOn(api, "deleteSession")
      .mockResolvedValue(undefined as never);
    const store = makeStore({
      sessions: [ses("ses_1", 2), ses("ses_2", 1)],
      messages: { ses_1: [], ses_2: [] },
      currentID: "ses_1",
    });
    const p = store.removeSession("ses_1");
    // optimistic: удалено ДО ответа сервера
    expect(store.sessions.map((s) => s.id)).toEqual(["ses_2"]);
    expect("ses_1" in store.messages).toBe(false);
    expect(store.currentID).toBeNull();
    await p;
    expect(del).toHaveBeenCalledWith("ses_1");
    expect(store.sessions.map((s) => s.id)).toEqual(["ses_2"]);
  });

  it("при ошибке сервера возвращает сессию, сообщения и currentID", async () => {
    vi.spyOn(api, "deleteSession").mockRejectedValue(new Error("500"));
    const msg = [{ id: "m1", role: "user", parts: [] }];
    const store = makeStore({
      sessions: [ses("ses_1", 2), ses("ses_2", 1)],
      messages: { ses_1: msg as never, ses_2: [] },
      currentID: "ses_1",
    });
    await store.removeSession("ses_1");
    expect(store.sessions.map((s) => s.id).sort()).toEqual(["ses_1", "ses_2"]);
    expect(store.messages.ses_1).toBe(msg);
    expect(store.currentID).toBe("ses_1");
    expect(store.error).toBe("500");
  });

  it("откат не затирает сессии, пришедшие по SSE во время удаления", async () => {
    let reject: (e: Error) => void = () => {};
    vi.spyOn(api, "deleteSession").mockImplementation(
      () =>
        new Promise((_, rej) => {
          reject = rej;
        }) as never,
    );
    const store = makeStore({
      sessions: [ses("ses_1", 2)],
      messages: { ses_1: [] },
      currentID: "ses_1",
    });
    const p = store.removeSession("ses_1");
    // пока запрос в полёте — по SSE пришла новая сессия
    store.sessions = [...store.sessions, ses("ses_new", 9)];
    reject(new Error("boom"));
    await p;
    const ids = store.sessions.map((s) => s.id);
    expect(ids).toHaveLength(2);
    expect(ids).toContain("ses_new");
    expect(ids).toContain("ses_1");
  });

  it("откат не дублирует сессию, если она уже вернулась по SSE", async () => {
    let reject: (e: Error) => void = () => {};
    vi.spyOn(api, "deleteSession").mockImplementation(
      () =>
        new Promise((_, rej) => {
          reject = rej;
        }) as never,
    );
    const store = makeStore({
      sessions: [ses("ses_1", 2)],
      messages: { ses_1: [] },
      currentID: "ses_1",
    });
    const p = store.removeSession("ses_1");
    store.sessions = [...store.sessions, ses("ses_1", 2)]; // SSE вернул её раньше
    reject(new Error("boom"));
    await p;
    expect(store.sessions.filter((s) => s.id === "ses_1")).toHaveLength(1);
  });

  it("откат уважает выбор пользователя: currentID не трогается, если сменился", async () => {
    let reject: (e: Error) => void = () => {};
    vi.spyOn(api, "deleteSession").mockImplementation(
      () =>
        new Promise((_, rej) => {
          reject = rej;
        }) as never,
    );
    const store = makeStore({
      sessions: [ses("ses_1", 2), ses("ses_2", 1)],
      messages: { ses_1: [], ses_2: [] },
      currentID: "ses_1",
    });
    const p = store.removeSession("ses_1");
    store.currentID = "ses_2"; // пользователь переключился во время удаления
    reject(new Error("boom"));
    await p;
    expect(store.currentID).toBe("ses_2");
  });
});
