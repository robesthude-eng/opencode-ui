import { useState, memo } from "react";
import type { Message, Part, ToolPart } from "../api/types";
import CopyButton from "./CopyButton";
import PartView from "./PartView";
import ToolGroup from "./ToolGroup";
import { cn } from "@/lib/utils";

function getMessageText(message: Message): string {
  if (!message.parts) return "";
  return message.parts
    .map((p) => {
      if (p.type === "text" || p.type === "reasoning") return (p as any).text || "";
      if (p.type === "tool") {
        const out = (p as any).state?.output ?? (p as any).output;
        if (typeof out === "string") return out;
        if (out && typeof out === "object" && out.text) return out.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

interface ToolGroupData { kind: "group"; tool: string; parts: ToolPart[]; }
type RenderItem = Part | ToolGroupData;

function groupParts(parts: Part[]): RenderItem[] {
  const result: RenderItem[] = [];
  let i = 0;
  while (i < parts.length) {
    const part = parts[i] as { type?: string; tool?: string };
    if (part.type === "tool" && part.tool) {
      const group: ToolPart[] = [parts[i] as ToolPart];
      let j = i + 1;
      while (j < parts.length) {
        const next = parts[j] as { type?: string; tool?: string };
        if (next.type === "tool" && next.tool === part.tool) {
          group.push(parts[j] as ToolPart);
          j++;
        } else break;
      }
      if (group.length > 1) {
        result.push({ kind: "group", tool: part.tool, parts: group });
      } else {
        result.push(parts[i]);
      }
      i = j;
    } else {
      result.push(parts[i]);
      i++;
    }
  }
  return result;
}

function MessageItem({ message, isWorking }: { message: Message; isWorking?: boolean }) {
  const [showUserActions, setShowUserActions] = useState(false);
  const role = message.role || (message.info?.role as string | undefined) || "assistant";
  const isUser = role === "user";
  const items = groupParts(message.parts || []);
  const msgText = getMessageText(message);

  return (
    <div className={cn(
      "flex gap-3 py-5 px-3 md:px-6",
      isUser ? "justify-end" : "justify-start"
    )}>
      {!isUser && (
        <div className={cn(
          "h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5",
          "bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white text-sm",
          isWorking && "animate-pulse"
        )}>
          ✦
        </div>
      )}
      <div
        className={cn(
          "relative max-w-[78%] md:max-w-[720px] rounded-2xl px-4 py-3",
          isUser
            ? "bg-primary text-primary-foreground shadow"
            : "bg-card border border-border",
          "group"
        )}
        onClick={isUser ? () => setShowUserActions(v => !v) : undefined}
      >
        {isUser && (
          <div className={cn(
            "absolute -top-2 right-2 transition-opacity",
            showUserActions ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}>
            <CopyButton text={msgText} title="Copy message" className="!bg-background/80 !text-foreground backdrop-blur rounded-lg shadow" />
          </div>
        )}
        {message.info?.error && (
          <div className="mb-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {message.info.error.message || (message.info.error as any).data?.message || (typeof message.info.error === "string" ? message.info.error : "Ошибка API: проверьте тариф модели или ключ")}
          </div>
        )}
        <div className={cn("prose prose-invert prose-sm max-w-none", "prose-p:my-2 prose-pre:my-2", isUser && "prose-invert")}>
          {(() => {
            const attParts = items.filter((item) => (item as any).type === "attachment");
            const otherParts = items.filter((item) => (item as any).type !== "attachment");
            return (
              <>
                {attParts.length > 0 && (
                  <div className="flex flex-wrap gap-2 not-prose mb-2">
                    {attParts.map((item, i) => (
                      <PartView key={`att-${i}`} part={item as Part} />
                    ))}
                  </div>
                )}
                {otherParts.map((item, i) => {
                  const g = item as ToolGroupData;
                  if ((g as any).kind === "group") {
                    return <ToolGroup key={i} tool={g.tool} parts={g.parts} />;
                  }
                  return <PartView key={i} part={item as Part} isLastStreaming={isWorking && i === otherParts.length - 1} />;
                })}
              </>
            );
          })()}
        </div>
        {!isUser && msgText && (
          <div className="mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <CopyButton text={msgText} title="Copy message" />
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(MessageItem);
