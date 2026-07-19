import { memo } from "react";
import { cn } from "@/lib/utils";
import type { Message, Part, ToolOutput, ToolPart } from "../api/types";
import { AttachmentChip, splitAttachmentLines } from "./AttachmentChip";
import CopyButton from "./CopyButton";
import PartView from "./PartView";
import ToolGroup from "./ToolGroup";

function getMessageText(message: Message): string {
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

interface ToolGroupData {
  kind: "group";
  tool: string;
  parts: ToolPart[];
}
type RenderItem = Part | ToolGroupData;

function toolName(p: { tool?: unknown }): string | undefined {
  // Defensive: opencode can send `tool` as {messageID, callID} object reference
  // during streaming. Treat non-strings as "unknown tool" so grouping/rendering
  // never sees an object (prevents React error #31).
  return typeof p.tool === "string" && p.tool ? p.tool : undefined;
}

function groupParts(parts: Part[]): RenderItem[] {
  const result: RenderItem[] = [];
  let i = 0;
  while (i < parts.length) {
    const cur = parts[i];
    if (!cur) break; // noUncheckedIndexedAccess: за пределами массива
    const part = cur as { type?: string; tool?: unknown };
    const name = toolName(part);
    if (part.type === "tool" && name) {
      const group: ToolPart[] = [parts[i] as ToolPart];
      // Reasoning-части («Думал…») между одинаковыми действиями не разрывают
      // группу: собираем их отдельно и рендерим после группы.
      const skippedReasoning: Part[] = [];
      let j = i + 1;
      while (j < parts.length) {
        const next = parts[j] as { type?: string; tool?: unknown };
        if (next.type === "tool" && toolName(next) === name) {
          group.push(parts[j] as ToolPart);
          j++;
        } else if (next.type === "reasoning") {
          // Заглядываем вперёд через подряд идущие reasoning-части:
          // если за ними то же действие — группа продолжается.
          let k = j;
          while (
            k < parts.length &&
            (parts[k] as { type?: string }).type === "reasoning"
          ) {
            k++;
          }
          const after = parts[k] as
            | { type?: string; tool?: unknown }
            | undefined;
          if (after && after.type === "tool" && toolName(after) === name) {
            for (let m = j; m < k; m++) {
              const rp = parts[m];
              if (rp) skippedReasoning.push(rp);
            }
            j = k;
          } else break;
        } else break;
      }
      if (group.length > 1) {
        result.push({ kind: "group", tool: name, parts: group });
      } else {
        result.push(cur);
      }
      for (const r of skippedReasoning) result.push(r);
      i = j;
    } else {
      result.push(cur);
      i++;
    }
  }
  return result;
}

function MessageItem({
  messages,
  isWorking,
}: {
  messages: Message | Message[];
  isWorking?: boolean;
}) {
  const msgArray = Array.isArray(messages) ? messages : [messages];
  const firstMsg = msgArray[0];
  const role =
    firstMsg?.role ||
    (firstMsg?.info?.role as string | undefined) ||
    "assistant";
  const isUser = role === "user";

  const combinedText = msgArray
    .map((m) => getMessageText(m))
    .filter(Boolean)
    .join("\n\n");

  if (isUser) {
    // Мокап-стиль: метка «ВЫ» + линия слева, без пузыря.
    return (
      <div className="group oc-msg-in flex flex-col gap-1.5 px-3 py-2 md:px-6">
        <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
          вы
        </div>
        <div className="flex min-w-0 flex-col gap-1 border-l border-border pl-3 md:pl-4">
          {msgArray.map((message, idx) => {
            const msgText = getMessageText(message);
            const { attLines, rest } = splitAttachmentLines(msgText);
            return (
              <div
                key={message.id || idx}
                className="flex max-w-[min(100%,800px)] flex-col gap-1.5"
              >
                {attLines.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {attLines.map((l, i) => (
                      <AttachmentChip key={`att-${i}`} line={l} />
                    ))}
                  </div>
                )}
                {(rest || attLines.length === 0) && (
                  <div className="whitespace-pre-wrap break-words text-[14.5px] leading-relaxed text-foreground">
                    {rest || "…"}
                  </div>
                )}
              </div>
            );
          })}
          {combinedText && (
            <div className="mt-0.5 flex opacity-0 transition-opacity focus-within:opacity-100 hover:opacity-100 group-hover:opacity-60">
              <CopyButton
                text={combinedText}
                title="Copy"
                className="h-7 w-7"
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  // Assistant: мокап-стиль — метка «АГЕНТ» + акцентная линия слева, без пузыря.
  return (
    <div className="oc-msg-in flex flex-col gap-1.5 px-3 py-2 md:px-6">
      <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/80">
        агент
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 border-l border-primary/20 pl-3 md:pl-4">
        <div className="min-w-0 max-w-[min(100%,800px)] space-y-1">
          {msgArray.map((message, msgIdx) => {
            const items = groupParts(message.parts || []);
            return (
              <div
                key={message.id || msgIdx}
                className="text-[14.5px] leading-relaxed text-foreground/95"
              >
                {message.info?.error && (
                  <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400 mb-2">
                    {typeof message.info.error === "string"
                      ? message.info.error
                      : typeof (message.info.error as Record<string, unknown>)
                            .message === "string"
                        ? String(
                            (message.info.error as Record<string, unknown>)
                              .message,
                          )
                        : typeof (message.info.error as any)?.data?.message ===
                            "string"
                          ? String((message.info.error as any).data.message)
                          : "Ошибка API: проверьте тариф модели или ключ"}
                  </div>
                )}
                {(() => {
                  const attParts = items.filter(
                    (item) =>
                      "type" in item &&
                      (item.type === "attachment" || item.type === "file"),
                  );
                  const otherParts = items.filter(
                    (item) =>
                      !("type" in item) ||
                      (item.type !== "attachment" && item.type !== "file"),
                  );
                  return (
                    <>
                      {attParts.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-2">
                          {attParts.map((item, i) => (
                            <PartView key={`att-${i}`} part={item as Part} />
                          ))}
                        </div>
                      )}
                      {otherParts.map((item, i) => {
                        const g = item as ToolGroupData;
                        if ("kind" in g && g.kind === "group") {
                          return (
                            <ToolGroup key={i} tool={g.tool} parts={g.parts} />
                          );
                        }
                        return (
                          <PartView
                            key={i}
                            part={item as Part}
                            {...(isWorking &&
                            msgIdx === msgArray.length - 1 &&
                            i === otherParts.length - 1
                              ? { isLastStreaming: true }
                              : {})}
                          />
                        );
                      })}
                    </>
                  );
                })()}
              </div>
            );
          })}
        </div>

        {/* Arena-style Footer: Avatar and Copy Button */}
        <div className="flex items-center gap-1.5 mt-0.5 pl-1">
          {/* Пока агент работает, процесс показывает аура-индикатор в ленте;
            обычный значок появляется только после завершения. */}
          {!isWorking && (
            <div
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-md",
                "border border-border bg-card font-mono text-[8px] font-bold text-primary",
              )}
            >
              &gt;_
            </div>
          )}
          {combinedText && (
            <div className="opacity-60 transition-opacity hover:opacity-100 focus-within:opacity-100">
              <CopyButton
                text={combinedText}
                title="Copy message"
                className="h-7 w-7"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function sameMessageItems(
  prev: { messages: Message | Message[]; isWorking?: boolean },
  next: { messages: Message | Message[]; isWorking?: boolean },
): boolean {
  if (prev.isWorking !== next.isWorking) return false;
  const prevList = Array.isArray(prev.messages)
    ? prev.messages
    : [prev.messages];
  const nextList = Array.isArray(next.messages)
    ? next.messages
    : [next.messages];
  return (
    prevList.length === nextList.length &&
    prevList.every((message, i) => message === nextList[i])
  );
}

export default memo(MessageItem, sameMessageItems);
