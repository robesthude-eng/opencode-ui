import { describe, expect, it } from "vitest";
import type { Message } from "../api/types";
import { buildChatMarkdown, messageText } from "./chatText";

const userMsg: Message = {
  id: "m1",
  role: "user",
  parts: [{ type: "text", text: "Привет" }],
  time: { created: 1700000000000 },
};

const assistantMsg: Message = {
  id: "m2",
  role: "assistant",
  parts: [
    { type: "text", text: "Здравствуйте!" },
    { type: "text", text: "Чем помочь?" },
  ],
};

describe("messageText", () => {
  it("склеивает текстовые части через пустую строку", () => {
    expect(messageText(assistantMsg)).toBe("Здравствуйте!\n\nЧем помочь?");
  });

  it("возвращает пустую строку без частей", () => {
    expect(messageText({ id: "x", role: "user", parts: [] })).toBe("");
  });
});

describe("buildChatMarkdown", () => {
  it("строит markdown с заголовком и ролями", () => {
    const md = buildChatMarkdown([userMsg, assistantMsg], "Тест");
    expect(md).toContain("# Тест");
    expect(md).toContain("🧑 Пользователь");
    expect(md).toContain("🤖 Ассистент");
    expect(md).toContain("Привет");
    expect(md).toContain("Чем помочь?");
  });
});
