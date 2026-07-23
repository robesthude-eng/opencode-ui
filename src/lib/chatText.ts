import type { Message, ToolOutput, ToolPart } from "../api/types";

/**
 * Извлекает читаемый текст сообщения: текстовые части, рассуждения и
 * вывод инструментов. Вынесено из MessageItem для переиспользования в
 * экспорте чата, поиске по сообщениям и кнопке «Спросить ещё раз».
 */
export function messageText(message: Message): string {
  if (!message.parts) return "";
  return message.parts
    .map((p) => {
      if ((p.type === "text" || p.type === "reasoning") && "text" in p)
        return typeof p.text === "string" ? p.text : "";
      if (p.type === "tool") {
        const toolP = p as ToolPart;
        const state = typeof toolP.state === "object" ? toolP.state : undefined;
        const stateOut = state?.output;
        const out: unknown =
          typeof stateOut === "string"
            ? stateOut
            : ((stateOut as ToolOutput | undefined) ?? toolP.output);
        if (typeof out === "string") return out;
        if (
          out &&
          typeof out === "object" &&
          "text" in out &&
          typeof out.text === "string"
        )
          return out.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

/** Markdown-представление диалога для экспорта или переноса в другой чат. */
export function buildChatMarkdown(messages: Message[], title: string): string {
  const lines: string[] = [`# ${title}`, ""];
  for (const m of messages) {
    if (m.role === "system") continue;
    const who = m.role === "user" ? "🧑 Пользователь" : "🤖 Ассистент";
    const when = m.time?.created
      ? new Date(m.time.created).toLocaleString("ru-RU")
      : "";
    lines.push(`## ${who}${when ? ` — ${when}` : ""}`, "");
    lines.push(messageText(m).trim() || "_(без текста)_", "");
  }
  return lines.join("\n");
}

/** Скачивает текст как файл через временную blob-ссылку. */
export function downloadTextFile(fileName: string, text: string): void {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
