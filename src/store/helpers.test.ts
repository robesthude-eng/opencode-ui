// biome-ignore lint/suspicious/noExplicitAny: test file uses any for flexibility
import { describe, expect, it } from "vitest";
import type { Message, Part } from "../api/types";
import {
  cleanSysText,
  normalizeMessage,
  normalizeMessages,
  patchPart,
  patchPartDelta,
  upsertMessage,
} from "./helpers";

describe("helpers.ts — Token & Message Processing Architecture", () => {
  describe("cleanSysText()", () => {
    it("1. strips system self-improvement instructions from text", () => {
      const input =
        "Hello world!\n\n[SYSTEM: Режим саморазвития ВКЛЮЧЁН. Для изолированных файлов или проектов данного чата используйте директорию sessions/s123/. При удалении чата эта папка будет автоматически удалена.]";
      expect(cleanSysText(input)).toBe("Hello world!");
    });

    it("2. returns empty string for falsy or non-string inputs", () => {
      expect(cleanSysText(null as any)).toBe("");
      expect(cleanSysText(undefined as any)).toBe("");
      expect(cleanSysText(123 as any)).toBe(123 as any);
    });

    it("3. preserves standard text without system tags unchanged", () => {
      const normal = "Can you write a React component for me?";
      expect(cleanSysText(normal)).toBe(normal);
    });
  });

  describe("normalizeMessage()", () => {
    it("4. extracts id and role from info object if missing at top level (opencode 1.17.x)", () => {
      const raw: any = {
        info: { id: "msg_100", role: "assistant" },
        parts: [{ type: "text", text: "Hello!" }],
      };
      const res = normalizeMessage(raw);
      expect(res.id).toBe("msg_100");
      expect(res.role).toBe("assistant");
    });

    it("5. cleans system prompt instructions from user message text parts", () => {
      const raw: Message = {
        id: "msg_user_1",
        role: "user",
        parts: [
          {
            type: "text",
            text: "Help me check bugs\n\n[SYSTEM: Режим саморазвития отключён...]",
          },
        ],
      };
      const res = normalizeMessage(raw);
      expect((res.parts[0] as any).text).toBe("Help me check bugs");
    });

    it("6. leaves assistant messages untouched by system text cleaning", () => {
      const raw: Message = {
        id: "msg_ai_1",
        role: "assistant",
        parts: [
          { type: "text", text: "Here is the code:\n\n[SYSTEM: something]" },
        ],
      };
      const res = normalizeMessage(raw);
      expect((res.parts[0] as any).text).toContain("[SYSTEM: something]");
    });
  });

  describe("normalizeMessages()", () => {
    it("7. maps an array of raw messages through normalizeMessage", () => {
      const input: any[] = [
        {
          info: { id: "m1", role: "user" },
          parts: [
            { type: "text", text: "Hi\n\n[SYSTEM: Режим саморазвития тест]" },
          ],
        },
        {
          info: { id: "m2", role: "assistant" },
          parts: [{ type: "text", text: "Hello there" }],
        },
      ];
      const res = normalizeMessages(input);
      expect(res).toHaveLength(2);
      expect(res[0].id).toBe("m1");
      expect((res[0].parts[0] as any).text).toBe("Hi");
      expect(res[1].id).toBe("m2");
    });
  });

  describe("upsertMessage()", () => {
    it("8. appends a brand new message if its ID is not in the array", () => {
      const existing: Message[] = [{ id: "m1", role: "user", parts: [] }];
      const newMsg: Message = {
        id: "m2",
        role: "assistant",
        parts: [{ type: "text", text: "Ok" }],
      };
      const res = upsertMessage(existing, newMsg);
      expect(res).toHaveLength(2);
      expect(res[1].id).toBe("m2");
    });

    it("9. replaces optimistic local_... user message with authoritative server message ID without duplication", () => {
      const existing: Message[] = [
        {
          id: "local_1700000",
          role: "user",
          parts: [{ type: "text", text: "Fix this bug" }],
        },
      ];
      const serverMsg: Message = {
        id: "msg_server_888",
        role: "user",
        parts: [{ type: "text", text: "Fix this bug" }],
      };
      const res = upsertMessage(existing, serverMsg);
      expect(res).toHaveLength(1);
      expect(res[0].id).toBe("msg_server_888");
    });

    it("10. updates existing message while preserving accumulated text/tool parts when server sends info-only update", () => {
      const existing: Message[] = [
        {
          id: "msg_ai_5",
          role: "assistant",
          parts: [{ type: "text", text: "Accumulated streaming text..." }],
        },
      ];
      const infoUpdate: Message = {
        id: "msg_ai_5",
        role: "assistant",
        parts: [],
      };
      const res = upsertMessage(existing, infoUpdate);
      expect(res).toHaveLength(1);
      expect(res[0].parts).toHaveLength(1);
      expect((res[0].parts[0] as any).text).toBe(
        "Accumulated streaming text...",
      );
    });
  });

  describe("patchPart()", () => {
    it("11. creates message shell with incoming part if target message does not exist yet", () => {
      const existing: Message[] = [];
      const part: Part = { type: "text", text: "First chunk" };
      const res = patchPart(existing, "msg_new_1", part);
      expect(res).toHaveLength(1);
      expect(res[0].id).toBe("msg_new_1");
      expect(res[0].parts[0]).toEqual(part);
    });

    it("12. updates existing un-IDd text part in place instead of duplicating", () => {
      const existing: Message[] = [
        {
          id: "msg_1",
          role: "assistant",
          parts: [{ type: "text", text: "Initial" }],
        },
      ];
      const newPart: Part = { type: "text", text: "Updated text" };
      const res = patchPart(existing, "msg_1", newPart);
      expect(res).toHaveLength(1);
      expect(res[0].parts).toHaveLength(1);
      expect((res[0].parts[0] as any).text).toBe("Updated text");
    });

    it("13. updates existing IDd part by matching part ID", () => {
      const existing: Message[] = [
        {
          id: "msg_1",
          role: "assistant",
          parts: [{ id: "part_a", type: "tool", tool: "bash" } as any],
        },
      ];
      const updatedPart: any = {
        id: "part_a",
        type: "tool",
        tool: "bash",
        status: "completed",
      };
      const res = patchPart(existing, "msg_1", updatedPart);
      expect(res[0].parts).toHaveLength(1);
      expect((res[0].parts[0] as any).status).toBe("completed");
    });
  });

  describe("patchPartDelta() — Real-time Character Streaming", () => {
    it("14. appends delta string character by character during live SSE streaming", () => {
      const existing: Message[] = [
        {
          id: "msg_1",
          role: "assistant",
          parts: [{ id: "p_1", type: "text", text: "Hello" } as any],
        },
      ];
      const res = patchPartDelta(existing, "msg_1", "p_1", "text", ", world!");
      expect((res[0].parts[0] as any).text).toBe("Hello, world!");
    });

    it("15. handles non-string deltas and creates stub part if part ID does not exist yet", () => {
      const existing: Message[] = [
        { id: "msg_1", role: "assistant", parts: [] },
      ];
      const res = patchPartDelta(
        existing,
        "msg_1",
        "p_99",
        "status",
        "running",
      );
      expect(res[0].parts).toHaveLength(1);
      expect((res[0].parts[0] as any).id).toBe("p_99");
      expect((res[0].parts[0] as any).status).toBe("running");
    });
  });
});
