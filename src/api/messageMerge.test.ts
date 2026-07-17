import { describe, expect, test } from "vitest";
import { createScenarioHarness, mergeMessages } from "./messageMerge";

describe("mergeMessages deterministic", () => {
  test("keeps longer local streaming text when server not final", () => {
    const server = [
      {
        id: "msg_1",
        role: "assistant" as const,
        parts: [{ id: "p1", type: "text", text: "first" } as any],
        info: { finish: undefined },
      },
    ];
    const local = [
      {
        id: "msg_1",
        role: "assistant" as const,
        parts: [{ id: "p1", type: "text", text: "first second" } as any],
      },
    ];
    const merged = mergeMessages(server, local);
    expect((merged[0].parts[0] as any).text).toBe("first second");
  });

  test("server wins when final", () => {
    const server = [
      {
        id: "msg_1",
        role: "assistant" as const,
        parts: [{ id: "p1", type: "text", text: "first" } as any],
        info: { finish: "stop", time: { completed: Date.now() } },
      },
    ];
    const local = [
      {
        id: "msg_1",
        role: "assistant" as const,
        parts: [{ id: "p1", type: "text", text: "first second" } as any],
      },
    ];
    const merged = mergeMessages(server, local);
    expect((merged[0].parts[0] as any).text).toBe("first");
  });

  test("preserves local attachment when server has none", () => {
    const server = [
      {
        id: "msg_1",
        role: "user" as const,
        parts: [{ type: "text", text: "hi" } as any],
      },
    ];
    const local = [
      {
        id: "msg_1",
        role: "user" as const,
        parts: [
          { type: "attachment", name: "a.txt" } as any,
          { type: "text", text: "hi" } as any,
        ],
      },
    ];
    const merged = mergeMessages(server, local);
    expect(merged[0].parts.some((p: any) => p.type === "attachment")).toBe(
      true,
    );
  });

  test("scenario harness with delta", () => {
    const harness = createScenarioHarness(
      [
        {
          id: "msg_1",
          role: "assistant",
          parts: [{ id: "p1", type: "text", text: "first" }],
        } as any,
      ],
      [
        {
          id: "msg_1",
          role: "assistant",
          parts: [{ id: "p1", type: "text", text: "first" }],
        } as any,
      ],
    );
    harness.applyLocalDelta("ses", "msg_1", "p1", " second");
    expect((harness.getLocal()[0].parts[0] as any).text).toBe("first second");
    const merged = harness.getMerged();
    expect((merged[0].parts[0] as any).text).toBe("first second");
  });

  test("out-of-order delta creates missing part", () => {
    const harness = createScenarioHarness(
      [
        {
          id: "msg_1",
          role: "assistant",
          parts: [{ id: "p1", type: "text", text: "first" }],
        } as any,
      ],
      [
        {
          id: "msg_1",
          role: "assistant",
          parts: [{ id: "p1", type: "text", text: "first" }],
        } as any,
      ],
    );
    // Simulate server sends delta for part that doesn't exist locally yet
    const serverWithNewPart = [
      {
        id: "msg_1",
        role: "assistant" as const,
        parts: [
          { id: "p1", type: "text", text: "first" } as any,
          { id: "p_late", type: "text", text: "arrived first" } as any,
        ],
      },
    ];
    const merged = harness.applyServerUpdate(serverWithNewPart);
    expect(merged[0].parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "p_late" })]),
    );
  });
});
