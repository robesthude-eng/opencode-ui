import { beforeEach, describe, expect, it } from "vitest";
import { SessionFsm } from "./sessionFsm";

describe("SessionFsm", () => {
  let fsm: SessionFsm;

  beforeEach(() => {
    fsm = new SessionFsm();
  });

  it("tracks busy state per session", () => {
    expect(fsm.isBusy("a")).toBe(false);
    fsm.markBusy("a");
    expect(fsm.isBusy("a")).toBe(true);
    expect(fsm.isBusy("b")).toBe(false);
    fsm.markIdle("a");
    expect(fsm.isBusy("a")).toBe(false);
  });

  it("resolveIdle fires and clears the resolver once", () => {
    let calls = 0;
    fsm.onIdle("a", () => calls++);
    expect(fsm.resolveIdle("a")).toBe(true);
    expect(calls).toBe(1);
    // повторный вызов — no-op
    expect(fsm.resolveIdle("a")).toBe(false);
    expect(calls).toBe(1);
  });

  it("returns false when no resolver registered", () => {
    expect(fsm.resolveIdle("missing")).toBe(false);
  });

  it("chains resolvers on double send (previous fires first)", () => {
    const order: string[] = [];
    fsm.onIdle("a", () => order.push("first"));
    fsm.onIdle("a", () => order.push("second"));
    expect(fsm.resolveIdle("a")).toBe(true);
    expect(order).toEqual(["first", "second"]);
  });

  it("swallows errors from a chained previous resolver", () => {
    let called = false;
    fsm.onIdle("a", () => {
      throw new Error("boom");
    });
    fsm.onIdle("a", () => {
      called = true;
    });
    expect(() => fsm.resolveIdle("a")).not.toThrow();
    expect(called).toBe(true);
  });

  it("clearIdleResolver removes without firing", () => {
    let calls = 0;
    fsm.onIdle("a", () => calls++);
    fsm.clearIdleResolver("a");
    expect(fsm.resolveIdle("a")).toBe(false);
    expect(calls).toBe(0);
  });

  it("markIdle does not clear the resolver (legacy behavior)", () => {
    let calls = 0;
    fsm.markBusy("a");
    fsm.onIdle("a", () => calls++);
    fsm.markIdle("a");
    expect(fsm.resolveIdle("a")).toBe(true);
    expect(calls).toBe(1);
  });

  it("keeps sessions isolated", () => {
    const order: string[] = [];
    fsm.onIdle("a", () => order.push("a"));
    fsm.onIdle("b", () => order.push("b"));
    fsm.resolveIdle("b");
    expect(order).toEqual(["b"]);
  });

  it("reset clears all state", () => {
    fsm.markBusy("a");
    fsm.onIdle("a", () => {});
    fsm.reset();
    expect(fsm.isBusy("a")).toBe(false);
    expect(fsm.resolveIdle("a")).toBe(false);
  });
});
