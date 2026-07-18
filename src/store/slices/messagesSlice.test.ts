import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, SessionGoneError } from "../../api/client";
import type { AppEvent, Message, SessionInfo } from "../../api/types";
import type { State } from "../types";
import { createMessagesSlice, flushStreamDeltas } from "./messagesSlice";

type Store = State & ReturnType<typeof createMessagesSlice>;

function event(type: string, properties: Record<string, unknown>): AppEvent {
  return { type, properties } as AppEvent;
}

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
  // Slice defaults are installed first; caller-supplied state models the existing store.
  Object.assign(store, slice, initial);
  return store;
}

const sid = "ses_stream";
const assistant: Message = {
  id: "msg_1",
  role: "assistant",
  parts: [{ id: "part_1", type: "text", text: "first" }],
};

describe("messagesSlice streaming event reducer", () => {
  let store: ReturnType<typeof makeStore>;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    store = makeStore({
      currentID: sid,
      messages: { [sid]: [assistant] },
      sessions: [
        { id: sid, title: "Stream", time: { updated: 1 } } as SessionInfo,
      ],
    });
  });

  test("keeps a newer SSE part when a later event updates the same message", () => {
    store.applyEvent(
      event("message.part.updated", {
        sessionID: sid,
        messageID: "msg_1",
        part: { id: "part_1", type: "text", text: "first second" },
      }),
    );

    expect(store.messages[sid][0].parts[0]).toMatchObject({
      text: "first second",
    });
  });

  test("does not lose accumulated text when a later info-only polling update arrives", () => {
    store.applyEvent(
      event("message.part.delta", {
        sessionID: sid,
        messageID: "msg_1",
        partID: "part_1",
        field: "text",
        delta: " second",
      }),
    );
    store.applyEvent(
      event("message.updated", {
        sessionID: sid,
        message: {
          id: "msg_1",
          role: "assistant",
          parts: [],
          info: { finish: "stop" },
        },
      }),
    );

    expect(store.messages[sid][0].parts[0]).toMatchObject({
      text: "first second",
    });
  });

  test("applies a streaming delta to an existing part", () => {
    store.applyEvent(
      event("message.part.delta", {
        sessionID: sid,
        messageID: "msg_1",
        partID: "part_1",
        field: "text",
        delta: " + delta",
      }),
    );
    // Релиз 3: дельты буферизуются (16мс) — в тесте досылаем явно.
    flushStreamDeltas();

    expect(store.messages[sid][0].parts[0]).toMatchObject({
      text: "first + delta",
    });
  });

  test("creates a missing streaming part instead of losing an out-of-order delta", () => {
    store.applyEvent(
      event("message.part.delta", {
        sessionID: sid,
        messageID: "msg_1",
        partID: "part_late",
        field: "text",
        delta: "arrived first",
      }),
    );
    // Релиз 3: дельты буферизуются (16мс) — в тесте досылаем явно.
    flushStreamDeltas();

    expect(store.messages[sid][0].parts).toContainEqual(
      expect.objectContaining({ id: "part_late", text: "arrived first" }),
    );
  });

  test("recovers from 410 Gone by replacing the stale session before retrying", async () => {
    const newSid = "ses_recovered";
    const prompt = vi
      .spyOn(api, "promptWithParts")
      .mockRejectedValueOnce(new SessionGoneError(sid, "gone"))
      .mockResolvedValueOnce({ info: { finish: "error" } } as Message);
    vi.spyOn(api, "listMessages").mockResolvedValue([]);
    store.newSession = async () => {
      Object.assign(store, {
        currentID: newSid,
        sessions: [
          {
            id: newSid,
            title: "Recovered",
            time: { updated: 2 },
          } as SessionInfo,
        ],
      });
    };

    await store.send("retry this prompt");
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(2));

    expect(store.sessions.map((session) => session.id)).toEqual([newSid]);
    expect(store.messages[sid]).toBeUndefined();
    expect(store.currentID).toBe(newSid);
  });

  test("removes a message when an SSE removal arrives", () => {
    store.applyEvent(
      event("message.removed", {
        sessionID: sid,
        messageID: "msg_1",
      }),
    );

    expect(store.messages[sid]).toEqual([]);
  });

  test("removes session state when an SSE removal arrives during streaming", () => {
    store.status[sid] = "busy";
    store.applyEvent(event("session.removed", { sessionID: sid }));

    expect(store.sessions).toEqual([]);
    expect(store.messages[sid]).toBeUndefined();
    expect(store.currentID).toBeNull();
  });
});
