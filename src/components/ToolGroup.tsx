import { ChevronDown, ChevronRight } from "lucide-react";
import { memo, useState } from "react";
import type { ToolPart } from "../api/types";
import { toolIcon } from "../utils/toolUtils";
import ToolCard from "./ToolCard";

function getState(part: ToolPart): string {
  const s = part.state;
  if (typeof s === "string") return s === "pending" ? "running" : s;
  if (s && typeof s === "object") {
    const status = (s as { status?: string }).status ?? "running";
    return status === "pending" ? "running" : status;
  }
  return "running";
}

function groupLabel(tool: string | undefined, count: number): string {
  const safeTool = typeof tool === "string" && tool ? tool : "tool";
  const t = safeTool.toLowerCase();
  if (t === "bash" || t === "shell" || t === "cmd") {
    return count === 1 ? "Ran command" : `Ran commands ${count}`;
  }
  if (t === "edit" || t === "write" || t === "applypatch") {
    return count === 1 ? "Edited file" : `Edited files ${count}`;
  }
  if (t === "read") return count === 1 ? "Read file" : `Read files ${count}`;
  return `${safeTool} ×${count}`;
}

const ToolGroup = ({ tool, parts }: { tool: string; parts: ToolPart[] }) => {
  const [manuallyToggled, setManuallyToggled] = useState<boolean | null>(null);
  const anyRunning = parts.some((p) => getState(p) === "running");
  const anyError = parts.some((p) => getState(p) === "error");
  // Reference behavior: group stays open in real time while any item is running.
  const expanded = manuallyToggled ?? anyRunning;
  const toolName = typeof tool === "string" ? tool : "tool";

  return (
    <div className="not-prose my-1">
      <button
        type="button"
        className="group/toolgrp flex w-full items-center gap-2 px-2 py-1.5 text-left rounded-lg hover:bg-accent/30 transition cursor-pointer"
        // Один клик переключает относительно видимого состояния (фикс двойного клика).
        onClick={() => setManuallyToggled(!expanded)}
      >
        <span className="text-muted-foreground/50 shrink-0">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </span>
        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
          {toolIcon(toolName)}
        </span>
        <span className="text-[13px] font-medium text-foreground/85">
          {groupLabel(toolName, parts.length)}
        </span>
        {anyRunning && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400 animate-pulse" />
        )}
        {!anyRunning && anyError && (
          <span className="text-[11px] font-medium text-red-400">error</span>
        )}
        <span className="flex-1" />
      </button>
      {expanded && (
        <div className="mt-1 ml-4 pl-3 border-l border-border/40 space-y-0.5">
          {parts.map((part, i) => (
            <ToolCard key={i} part={part} />
          ))}
        </div>
      )}
    </div>
  );
};

export default memo(ToolGroup);
