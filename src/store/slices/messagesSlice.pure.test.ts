// Релиз 5: тесты чистых функций, вынесенных из send() (Релиз 4, батч 4b).
import { describe, expect, it } from "vitest";
import type { ProcessedFile } from "../../api/files";
import type { Message } from "../../api/types";
import {
  assistantFinishState,
  buildAttachmentParts,
  buildPromptParts,
} from "./messagesSlice";

function att(over: Partial<ProcessedFile>): ProcessedFile {
  return {
    name: "file.txt",
    size: 10,
    mime: "text/plain",
    ext: "txt",
    kind: "text",
    ...over,
  } as ProcessedFile;
}

describe("buildAttachmentParts", () => {
  it("маппит вложения в attachment-части оптимистичного сообщения", () => {
    const parts = buildAttachmentParts([
      att({ name: "a.png", kind: "image", dataUrl: "data:image/png;base64,x" }),
      att({ name: "b.zip", kind: "zip", uploadedPath: "uploads/b.zip" }),
    ]);
    expect(parts).toEqual([
      {
        type: "attachment",
        name: "a.png",
        size: 10,
        kind: "image",
        path: undefined,
        dataUrl: "data:image/png;base64,x",
      },
      {
        type: "attachment",
        name: "b.zip",
        size: 10,
        kind: "zip",
        path: "uploads/b.zip",
        dataUrl: undefined,
      },
    ]);
  });

  it("пустой список вложений — пустой результат", () => {
    expect(buildAttachmentParts([])).toEqual([]);
  });
});

describe("buildPromptParts", () => {
  it("без вложений — только текст пользователя, и он всегда последним", () => {
    expect(buildPromptParts([], "привет")).toEqual([
      { type: "text", text: "привет" },
    ]);
  });

  it("image/pdf c part — data-URL части уходят как есть (vision)", () => {
    const img = {
      type: "file",
      mime: "image/png",
      url: "data:image/png;base64,x",
    };
    const pdf = {
      type: "file",
      mime: "application/pdf",
      url: "data:application/pdf;base64,y",
    };
    const parts = buildPromptParts(
      [
        att({ kind: "image", part: img as never }),
        att({ kind: "pdf", part: pdf as never }),
      ],
      "t",
    );
    expect(parts[0]).toBe(img);
    expect(parts[1]).toBe(pdf);
    expect(parts.at(-1)).toEqual({ type: "text", text: "t" });
  });

  it("текстовый файл с agentPath — file://-часть с encodeURI", () => {
    const parts = buildPromptParts(
      [att({ name: "мой файл.txt", agentPath: "/ws/мой файл.txt" })],
      "t",
    );
    expect(parts[0]).toEqual({
      type: "file",
      mime: "text/plain",
      filename: "мой файл.txt",
      url: `file://${encodeURI("/ws/мой файл.txt")}`,
    });
  });

  it("zip с uploadedPath — 📎-часть с числом файлов и пометкой про архив", () => {
    const parts = buildPromptParts(
      [
        att({
          name: "b.zip",
          kind: "zip",
          uploadedPath: "uploads/b.zip",
          entryCount: 3,
        }),
      ],
      "t",
    );
    expect(parts[0]).toEqual({
      type: "text",
      text: "📎 b.zip → uploads/b.zip (3 файлов внутри) — это zip-архив, ещё не распакован",
    });
  });

  it("бинарник с uploadedPath без entryCount — 📎-часть без хинта", () => {
    const parts = buildPromptParts(
      [att({ name: "c.bin", kind: "binary", uploadedPath: "uploads/c.bin" })],
      "t",
    );
    expect(parts[0]).toEqual({
      type: "text",
      text: "📎 c.bin → uploads/c.bin",
    });
  });

  it("fallback при неудачной загрузке: part, затем textPart", () => {
    const p = { type: "file", url: "data:x" };
    const tp = { type: "text", text: "inline" };
    expect(
      buildPromptParts([att({ kind: "binary", part: p as never })], "t")[0],
    ).toBe(p);
    expect(
      buildPromptParts(
        [att({ kind: "binary", textPart: tp as never })],
        "t",
      )[0],
    ).toBe(tp);
  });
});

describe("assistantFinishState", () => {
  const asst = (over: Partial<Message>): Message =>
    ({ id: "msg_a", role: "assistant", parts: [], ...over }) as Message;

  it("нет assistant-сообщений — не завершено", () => {
    const r = assistantFinishState([
      { id: "msg_u", role: "user", parts: [] } as unknown as Message,
    ]);
    expect(r.isDone).toBe(false);
    expect(r.sig).toBe("|0|0|");
  });

  it("finish=stop и finish=error — завершено", () => {
    const stop = asst({ info: { finish: "stop" } as Message["info"] });
    const error = asst({ info: { finish: "error" } as Message["info"] });
    expect(assistantFinishState([stop]).isDone).toBe(true);
    expect(assistantFinishState([error]).isDone).toBe(true);
  });

  it("time.completed — завершено, completedAt отдаётся наружу", () => {
    const r = assistantFinishState([
      asst({
        info: { time: { created: 1, completed: 42 } } as Message["info"],
      }),
    ]);
    expect(r.isDone).toBe(true);
    expect(r.completedAt).toBe(42);
  });

  it("стриминг без finish/completed — не завершено", () => {
    expect(assistantFinishState([asst({})]).isDone).toBe(false);
  });

  it("смотрит на ПОСЛЕДНЕГО assistant; сигнатура отражает его состояние", () => {
    const done = asst({
      id: "msg_1",
      info: { finish: "stop" } as Message["info"],
    });
    const streaming = asst({
      id: "msg_2",
      parts: [{ id: "p1", type: "text", text: "..." }] as Message["parts"],
    });
    const r = assistantFinishState([done, streaming]);
    expect(r.isDone).toBe(false);
    expect(r.sig).toBe("msg_2|0|1|");
  });
});
