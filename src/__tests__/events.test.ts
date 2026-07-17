/**
 * Tests for src/api/events.ts
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { EventStream } from "../api/events";

// Mock EventSource
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  readyState = 0;
  private listeners: Map<string, ((event: { data: string }) => void)[]> =
    new Map();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data: string }) => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type)?.push(listener);
  }

  close() {
    this.readyState = 2;
  }

  // Helper to simulate receiving an event
  simulateEvent(type: string, data: string) {
    if (type === "message") {
      this.onmessage?.({ data });
    } else {
      this.listeners.get(type)?.forEach((listener) => listener({ data }));
    }
  }

  // Helper to simulate error
  simulateError() {
    this.onerror?.();
  }
}

(global as any).EventSource = MockEventSource;

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(window, "localStorage", { value: localStorageMock });

describe("EventStream", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    localStorageMock.getItem.mockReturnValue(null);
  });

  test("creates EventSource with correct URL", () => {
    const stream = new EventStream("http://localhost:3000/api/event");
    stream.connect();

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe(
      "http://localhost:3000/api/event",
    );
  });

  test("uses cookie auth — default event URL has no token query", () => {
    const stream = new EventStream();
    stream.connect();
    expect(MockEventSource.instances[0].url).toBe("/api/event");
  });

  test("dispatches named events to handlers", () =>
    new Promise<void>((done) => {
      const stream = new EventStream("http://localhost:3000/api/event");

      stream.on((event) => {
        expect(event.type).toBe("session.created");
        expect(event.properties).toEqual({ id: "123" });
        done();
      });

      stream.connect();

      // Simulate event after connection
      setTimeout(() => {
        MockEventSource.instances[0].simulateEvent(
          "session.created",
          JSON.stringify({ id: "123" }),
        );
      }, 10);
    }));

  test("dispatches session.idle named events", () =>
    new Promise<void>((done) => {
      const stream = new EventStream("http://localhost:3000/api/event");

      stream.on((event) => {
        expect(event.type).toBe("session.idle");
        done();
      });

      stream.connect();
      setTimeout(() => {
        MockEventSource.instances[0].simulateEvent(
          "session.idle",
          JSON.stringify({ sessionID: "ses_1" }),
        );
      }, 10);
    }));

  test("dispatches unnamed valid-JSON events as 'message'", () =>
    new Promise<void>((done) => {
      const stream = new EventStream("http://localhost:3000/api/event");

      stream.on((event) => {
        if (event.type === "message") {
          expect(event.type).toBe("message");
          expect((event.properties as any).hello).toBe("world");
          done();
        }
      });

      stream.connect();

      setTimeout(() => {
        MockEventSource.instances[0].simulateEvent(
          "message",
          JSON.stringify({ hello: "world" }),
        );
      }, 10);
    }));

  test("emits stream.corrupted on invalid JSON chunks instead of dispatching broken data", () =>
    new Promise<void>((done) => {
      const stream = new EventStream("http://localhost:3000/api/event");

      stream.on((event) => {
        expect(event.type).toBe("stream.corrupted");
        expect((event.properties as any).raw).toBe("not json at all");
        done();
      });

      stream.connect();

      setTimeout(() => {
        MockEventSource.instances[0].simulateEvent(
          "message",
          "not json at all",
        );
      }, 10);
    }));

  test("reconnects on error", () =>
    new Promise<void>((done) => {
      const stream = new EventStream("http://localhost:3000/api/event");
      stream.connect();

      // Simulate error
      MockEventSource.instances[0].simulateError();

      // Should attempt to reconnect after delay
      setTimeout(() => {
        expect(MockEventSource.instances).toHaveLength(2);
        done();
      }, 1100);
    }));

  test("stops reconnecting after max attempts", () => {
    vi.useFakeTimers();
    try {
      const stream = new EventStream("http://localhost:3000/api/event");
      stream.connect();

      // Drive 50 errors; advance fake timers so each scheduled reconnect fires.
      for (let i = 0; i < 50; i++) {
        MockEventSource.instances[i].simulateError();
        vi.advanceTimersByTime(60000);
      }

      const initialCount = MockEventSource.instances.length;
      // One more error must NOT create a new instance (max reached).
      MockEventSource.instances[initialCount - 1].simulateError();
      vi.advanceTimersByTime(60000);

      expect(MockEventSource.instances.length).toBe(initialCount);
    } finally {
      vi.useRealTimers();
    }
  });

  test("cleans up on close", () => {
    const stream = new EventStream("http://localhost:3000/api/event");
    stream.connect();

    const es = MockEventSource.instances[0];
    stream.close();

    expect(es.readyState).toBe(2);
  });

  test("removes handler when unsubscribing", () => {
    const stream = new EventStream("http://localhost:3000/api/event");
    const handler = vi.fn();

    const unsubscribe = stream.on(handler);
    stream.connect();

    unsubscribe();

    // Simulate event
    MockEventSource.instances[0].simulateEvent("session.created", "{}");

    expect(handler).not.toHaveBeenCalled();
  });
});

// P3: конфигурируемый список именованных SSE-событий
describe("EventStream — configurable named types (P3)", () => {
  test("registers custom named event types passed via constructor", () => {
    const stream = new EventStream("http://localhost:3000/api/event", null, [
      "custom.event",
    ]);
    const received: Array<{ type: string }> = [];
    stream.on((e) => {
      received.push(e);
    });
    const es = MockEventSource.instances.at(-1);
    es?.simulateEvent(
      "custom.event",
      JSON.stringify({ type: "custom.event", properties: { foo: 1 } }),
    );
    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe("custom.event");
    stream.close();
  });

  test("still registers default named types when none are passed", () => {
    const stream = new EventStream("http://localhost:3000/api/event");
    const received: Array<{ type: string }> = [];
    stream.on((e) => {
      received.push(e);
    });
    const es = MockEventSource.instances.at(-1);
    es?.simulateEvent(
      "session.idle",
      JSON.stringify({ type: "session.idle", properties: {} }),
    );
    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe("session.idle");
    stream.close();
  });
});
