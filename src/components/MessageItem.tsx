import { memo } from "react";
import { cn } from "@/lib/utils";
import type { Message, Part, ToolOutput, ToolPart } from "../api/types";
import {
  AttachmentChip,
  splitAttachmentLines,
  WorkspaceFileChip,
} from "./AttachmentChip";
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

/** Приводит путь из инструмента/ответа к относительному пути workspace. */
function normalizeWorkspacePath(value: string): string | null {
  const path = value
    .trim()
    .replace(/^file:\/\//, "")
    .replace(/\\/g, "/")
    .replace(/^\/session\/workspace\//, "")
    .replace(/^sessions\/[^/]+\/workspace\//, "")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
  if (!path || path.split("/").includes("..")) return null;
  return path;
}

function toolCompleted(part: ToolPart): boolean {
  const state = part.state;
  const status =
    typeof state === "string"
      ? state
      : state && typeof state === "object"
        ? state.status
        : undefined;
  return (
    status === "completed" ||
    status === "success" ||
    (status == null && part.output != null)
  );
}

/**
 * Файлы, созданные стандартным инструментом Write. Это не новая копия:
 * карточка ведёт к тому же объекту в workspace текущей сессии.
 * Артефакты из Bash дополнительно приходят отдельной 📎-строкой по инструкции
 * модели, поэтому также становятся файл-карточками через PartView.
 */
function GeneratedFiles({ message }: { message: Message }) {
  const pathsInText = new Set<string>();
  for (const p of message.parts || []) {
    if (p.type !== "text" || typeof (p as { text?: unknown }).text !== "string")
      continue;
    const text = (p as { text: string }).text;
    for (const m of text.matchAll(/^📎 .+? → (\S+)/gm)) {
      const path = normalizeWorkspacePath(m[1] || "");
      if (path) pathsInText.add(path);
    }
  }

  const files = new Map<string, string>();
  for (const p of message.parts || []) {
    if (p.type !== "tool") continue;
    const tool = String((p as ToolPart).tool || "").toLowerCase();
    // Только write создаёт новый файл гарантированно. edit меняет уже
    // существующий файл и не должен каждый раз засорять ответ новой карточкой.
    if (tool !== "write" || !toolCompleted(p as ToolPart)) continue;
    const state = (p as ToolPart).state;
    const input =
      state && typeof state === "object" ? state.input : (p as ToolPart).input;
    if (!input || typeof input !== "object") continue;
    const raw =
      (input as Record<string, unknown>).filePath ??
      (input as Record<string, unknown>).path;
    if (typeof raw !== "string") continue;
    const path = normalizeWorkspacePath(raw);
    if (!path || pathsInText.has(path)) continue;
    const name = path.split("/").pop() || path;
    files.set(path, name);
  }

  if (files.size === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {[...files].map(([path, name]) => (
        <WorkspaceFileChip
          key={path}
          name={name}
          path={path}
          meta="Создано ассистентом · в workspace"
        />
      ))}
    </div>
  );
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
    return (
      <div className="group oc-msg-in flex flex-col items-end gap-1 px-3 py-1 md:px-6">
        <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70 self-end mr-1">
          вы
        </div>
        <div className="flex min-w-0 flex-col gap-1 items-end max-w-full border-r border-border/40 pr-3 md:pr-4">
          {msgArray.map((message, idx) => {
            const msgText = getMessageText(message);
            const { attLines, rest } = splitAttachmentLines(msgText);
            const realAttParts = (message.parts || []).filter(
              (p) => p.type === "attachment" || p.type === "file",
            );
            return (
              <div
                key={message.id || idx}
                className="flex flex-col gap-1 max-w-[min(100%,700px)] self-end text-right"
              >
                {(attLines.length > 0 || realAttParts.length > 0) && (
                  <div className="flex flex-wrap gap-2 justify-end">
                    {attLines.map((l, i) => (
                      <AttachmentChip key={`att-${i}`} line={l} />
                    ))}
                    {realAttParts.map((part, i) => (
                      <PartView key={`real-att-${i}`} part={part} />
                    ))}
                  </div>
                )}
                {(rest ||
                  (attLines.length === 0 && realAttParts.length === 0)) && (
                  <div className="whitespace-pre-wrap break-words text-[14.5px] leading-relaxed text-foreground/95 text-right">
                    {rest || "…"}
                  </div>
                )}
              </div>
            );
          })}
          {combinedText && (
            <div className="mt-0.5 flex opacity-0 transition-opacity focus-within:opacity-100 hover:opacity-100 group-hover:opacity-60 mr-1">
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
    <div className="oc-msg-in flex flex-col gap-1.5 px-3 py-1 md:px-6">
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
                <GeneratedFiles message={message} />
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

function isValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    typeof a === "object" &&
    a !== null &&
    typeof b === "object" &&
    b !== null
  ) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
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
  if (prevList.length !== nextList.length) return false;

  for (let i = 0; i < prevList.length; i++) {
    const pMsg = prevList[i];
    const nMsg = nextList[i];
    if (!pMsg || !nMsg) return pMsg === nMsg;
    if (pMsg === nMsg) continue;
    if (
      pMsg.id !== nMsg.id ||
      pMsg.role !== nMsg.role ||
      (pMsg.parts?.length ?? 0) !== (nMsg.parts?.length ?? 0)
    ) {
      return false;
    }
    const pParts = pMsg.parts ?? [];
    const nParts = nMsg.parts ?? [];
    for (let j = 0; j < pParts.length; j++) {
      const pPart = pParts[j];
      const nPart = nParts[j];
      if (!pPart || !nPart) return pPart === nPart;
      if (pPart === nPart) continue;
      if (
        pPart.id !== nPart.id ||
        pPart.type !== nPart.type ||
        !isValueEqual(
          (pPart as { text?: unknown }).text,
          (nPart as { text?: unknown }).text,
        ) ||
        !isValueEqual(
          (pPart as { output?: unknown }).output,
          (nPart as { output?: unknown }).output,
        ) ||
        !isValueEqual(
          (pPart as { reasoning?: unknown }).reasoning,
          (nPart as { reasoning?: unknown }).reasoning,
        ) ||
        !isValueEqual(
          (pPart as { status?: unknown }).status,
          (nPart as { status?: unknown }).status,
        ) ||
        !isValueEqual(
          (pPart as { state?: unknown }).state,
          (nPart as { state?: unknown }).state,
        ) ||
        !isValueEqual(
          (pPart as { tool?: unknown }).tool,
          (nPart as { tool?: unknown }).tool,
        ) ||
        !isValueEqual(
          (pPart as { callID?: unknown }).callID,
          (nPart as { callID?: unknown }).callID,
        ) ||
        !isValueEqual(
          (pPart as { input?: unknown }).input,
          (nPart as { input?: unknown }).input,
        ) ||
        !isValueEqual(
          (pPart as { name?: unknown }).name,
          (nPart as { name?: unknown }).name,
        ) ||
        !isValueEqual(
          (pPart as { size?: unknown }).size,
          (nPart as { size?: unknown }).size,
        ) ||
        !isValueEqual(
          (pPart as { kind?: unknown }).kind,
          (nPart as { kind?: unknown }).kind,
        ) ||
        !isValueEqual(
          (pPart as { path?: unknown }).path,
          (nPart as { path?: unknown }).path,
        ) ||
        !isValueEqual(
          (pPart as { dataUrl?: unknown }).dataUrl,
          (nPart as { dataUrl?: unknown }).dataUrl,
        ) ||
        !isValueEqual(
          (pPart as { filename?: unknown }).filename,
          (nPart as { filename?: unknown }).filename,
        ) ||
        !isValueEqual(
          (pPart as { url?: unknown }).url,
          (nPart as { url?: unknown }).url,
        )
      ) {
        return false;
      }
    }
  }
  return true;
}

export default memo(MessageItem, sameMessageItems);
