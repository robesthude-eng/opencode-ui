import { useState, memo } from "react";
import type { Message, Part, ToolPart } from "../api/types";
import CopyButton from "./CopyButton";
import PartView from "./PartView";
import ToolGroup from "./ToolGroup";

function getMessageText(message: Message): string {
  if (!message.parts) return "";
  return message.parts
    .map((p) => {
      if (p.type === "text" || p.type === "reasoning") return p.text || "";
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

// Group consecutive same-name tool parts.
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
  // In opencode 1.17.x, role is on the top level OR inside info.role.
  const role = message.role || (message.info?.role as string | undefined) || "assistant";
  const isUser = role === "user";
  const items = groupParts(message.parts || []);
  const msgText = getMessageText(message);

  return (
    <div className={`msg ${isUser ? "user" : "assistant"}`}>
      {!isUser && (
        <span className={`avatar assistant ${isWorking ? "working" : ""}`}>
          <span>✦</span>
        </span>
      )}
      <div
        className={`msg-content ${isUser && showUserActions ? "actions-visible" : ""}`}
        onClick={isUser ? () => setShowUserActions((v) => !v) : undefined}
      >
        {isUser && (
          <CopyButton text={msgText} title="Copy message" className="user-copy-btn" />
        )}
        {message.info?.error && (
          <div className="error-banner">
            {message.info.error.message || (message.info.error as any).data?.message || (typeof message.info.error === "string" ? message.info.error : "Ошибка API: проверьте тариф модели или ключ")}
          </div>
        )}
        <div className="msg-body">
          {(() => {
            const attParts = items.filter((item) => (item as any).type === "attachment");
            const otherParts = items.filter((item) => (item as any).type !== "attachment");
            return (
              <>
                {attParts.length > 0 && (
                  <div className="attachments-row">
                    {attParts.map((item, i) => (
                      <PartView key={`att-${i}`} part={item as Part} />
                    ))}
                  </div>
                )}
                {otherParts.map((item, i) => {
                  const g = item as ToolGroupData;
                  if (g.kind === "group") {
                    return <ToolGroup key={i} tool={g.tool} parts={g.parts} />;
                  }
                  return <PartView key={i} part={item as Part} isLastStreaming={isWorking && i === items.length - 1} />;
                })}
              </>
            );
          })()}
        </div>
        {!isUser && msgText && (
          <div className="assistant-actions">
            <CopyButton text={msgText} title="Copy message" className="action-copy-btn" />
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(MessageItem);
