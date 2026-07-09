/**
 * Tests for src/api/events.ts
 */
import { EventStream } from "../events";

// Mock EventSource
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  readyState = 0;
  private listeners: Map<string, ((event: { data: string }) => void)[]> = new Map();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    // Simulate async connection
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
    }, 0);
  }

  addEventListener(type: string, listener: (event: { data: string }) => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type)!.push(listener);
  }

  close() {
    this.readyState = 2;
  }

  // Helper to simulate receiving an event
  simulateEvent(type: string, data: string) {
    if (type === "message") {
      this.onmessage?.({ data });
    } else {
      this.listeners.get(type)?.forEach(listener => listener({ data }));
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
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
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
    expect(MockEventSource.instances[0].url).toBe("http://localhost:3000/api/event");
  });

  test("includes token in URL when available", () => {
    localStorageMock.getItem.mockReturnValue("test-token");
    
    const stream = new EventStream();
    stream.connect();

    expect(MockEventSource.instances[0].url).toContain("token=test-token");
  });

  test("dispatches named events to handlers", (done) => {
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
        JSON.stringify({ id: "123" })
      );
    }, 10);
  });

  test("dispatches unnamed events as 'message'", (done) => {
    const stream = new EventStream("http://localhost:3000/api/event");
    
    stream.on((event) => {
      expect(event.type).toBe("message");
      done();
    });

    stream.connect();

    setTimeout(() => {
      MockEventSource.instances[0].simulateEvent("message", "test data");
    }, 10);
  });

  test("reconnects on error", (done) => {
    const stream = new EventStream("http://localhost:3000/api/event");
    stream.connect();

    // Simulate error
    MockEventSource.instances[0].simulateError();

    // Should attempt to reconnect after delay
    setTimeout(() => {
      expect(MockEventSource.instances).toHaveLength(2);
      done();
    }, 1100);
  });

  test("stops reconnecting after max attempts", (done) => {
    const stream = new EventStream("http://localhost:3000/api/event");
    stream.connect();

    // Simulate many errors
    for (let i = 0; i < 50; i++) {
      MockEventSource.instances[i].simulateError();
      jest.advanceTimersByTime(1000 * Math.pow(2, i));
    }

    // Should not create more instances
    setTimeout(() => {
      const initialCount = MockEventSource.instances.length;
      MockEventSource.instances[initialCount - 1].simulateError();
      
      setTimeout(() => {
        expect(MockEventSource.instances.length).toBe(initialCount);
        done();
      }, 100);
    }, 100);
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
    const handler = jest.fn();
    
    const unsubscribe = stream.on(handler);
    stream.connect();

    unsubscribe();

    // Simulate event
    MockEventSource.instances[0].simulateEvent("session.created", "{}");

    expect(handler).not.toHaveBeenCalled();
  });
});
