import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import type { Message, Part, ToolPart } from "../api/types";
import CopyButton from "./CopyButton";
import PartView from "./PartView";
import ToolGroup from "./ToolGroup";

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

interface ToolGroupData {
  kind: "group";
  tool: string;
  parts: ToolPart[];
}
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

  // User: compact purple bubble (Arena-like)
  if (isUser) {
    return (
      <div className="flex justify-end px-3 md:px-6 py-2">
        <div
          className="group relative max-w-[85%] md:max-w-[70%]"
          onClick={() => setShowUserActions((v) => !v)}
        >
          <div
            className={cn(
              "absolute -top-2 right-1 transition-opacity z-10",
              showUserActions
                ? "opacity-100"
                : "opacity-60 group-hover:opacity-100 [@media(hover:none)]:opacity-100",
            )}
          >
            <CopyButton
              text={msgText}
              title="Copy"
              className="!bg-background/90 !text-foreground backdrop-blur rounded-lg shadow h-7 w-7"
            />
          </div>
          <div className="rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-[14.5px] leading-relaxed text-primary-foreground shadow-sm">
            <div className="whitespace-pre-wrap break-words">{msgText || "…"}</div>
          </div>
        </div>
      </div>
    );
  }

  // Assistant: open layout, avatar + content column (Arena-like, not heavy card)
  return (
    <div className="flex gap-2.5 px-3 md:px-6 py-3">
      <div
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
          "bg-gradient-to-br from-violet-500 to-fuchsia-500 text-[12px] text-white shadow-sm",
          isWorking && "animate-pulse",
        )}
      >
        ✦
      </div>
      <div className="min-w-0 flex-1 max-w-[min(100%,720px)] space-y-1.5">
        {message.info?.error && (
          <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {message.info.error.message ||
              (message.info.error as any).data?.message ||
              (typeof message.info.error === "string"
                ? message.info.error
                : "Ошибка API: проверьте тариф модели или ключ")}
          </div>
        )}
        <div className="text-[14.5px] leading-[1.55] text-foreground/95">
          {(() => {
            const attParts = items.filter((item) => (item as any).type === "attachment");
            const otherParts = items.filter((item) => (item as any).type !== "attachment");
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
                  if ((g as any).kind === "group") {
                    return <ToolGroup key={i} tool={g.tool} parts={g.parts} />;
                  }
                  return (
                    <PartView
                      key={i}
                      part={item as Part}
                      isLastStreaming={isWorking && i === otherParts.length - 1}
                    />
                  );
                })}
              </>
            );
          })()}
        </div>
        {msgText && (
          <div className="pt-0.5 opacity-60 transition-opacity hover:opacity-100 focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
            <CopyButton text={msgText} title="Copy message" className="h-7 w-7" />
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(MessageItem);
