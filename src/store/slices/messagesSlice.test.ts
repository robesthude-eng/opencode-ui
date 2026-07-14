import { beforeEach, describe, expect, test } from "vitest";
import type { AppEvent, Message, SessionInfo } from "../../api/types";
import { createMessagesSlice } from "./messagesSlice";
import type { State } from "../types";

type Store = Partial<State> & ReturnType<typeof createMessagesSlice>;

function event(type: string, properties: Record<string, unknown>): AppEvent {
  return { type, properties } as AppEvent;
}

function makeStore(initial: Partial<Store> = {}) {
  const store: Store = {
    sessions: [],
    status: {},
    permissions: [],
    messages: {},
    attachments: [],
    ...initial,
  };
  const set = (update: unknown) => {
    const next = typeof update === "function" ? update(store) : update;
    Object.assign(store, next);
  };
  const slice = createMessagesSlice(set as never, (() => store) as never, {} as never);
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

  beforeEach(() => {
    store = makeStore({
      currentID: sid,
      messages: { [sid]: [assistant] },
      sessions: [{ id: sid, title: "Stream", time: { updated: 1 } } as SessionInfo],
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

    expect(store.messages[sid][0].parts[0]).toMatchObject({ text: "first second" });
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

    expect(store.messages[sid][0].parts[0]).toMatchObject({ text: "first + delta" });
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

    expect(store.messages[sid][0].parts).toContainEqual(
      expect.objectContaining({ id: "part_late", text: "arrived first" }),
    );
  });

  test("removes session state when an SSE removal arrives during streaming", () => {
    store.status[sid] = "busy";
    store.applyEvent(event("session.removed", { sessionID: sid }));

    expect(store.sessions).toEqual([]);
    expect(store.messages[sid]).toBeUndefined();
    expect(store.currentID).toBeNull();
  });
});
