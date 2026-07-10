import { ChevronDown, ChevronRight } from "lucide-react";
import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import type { ToolPart } from "../api/types";
import { toolIcon } from "../utils/toolUtils";
import ToolCard from "./ToolCard";

function getState(part: ToolPart): string {
  const s = part.state;
  if (typeof s === "string") return s === "pending" ? "running" : s;
  if (s && typeof s === "object") {
    const status = (s as any).status ?? "running";
    return status === "pending" ? "running" : status;
  }
  return "running";
}

function groupLabel(tool: string, count: number): string {
  const t = tool.toLowerCase();
  if (t === "bash" || t === "shell" || t === "cmd") {
    return count === 1 ? "Ran command" : `Ran commands ${count}`;
  }
  if (t === "edit" || t === "write" || t === "applypatch") {
    return count === 1 ? "Edited file" : `Edited files ${count}`;
  }
  if (t === "read") return count === 1 ? "Read file" : `Read files ${count}`;
  return `${tool} ×${count}`;
}

const ToolGroup = ({ tool, parts }: { tool: string; parts: ToolPart[] }) => {
  const [manuallyToggled, setManuallyToggled] = useState<boolean | null>(null);
  const anyRunning = parts.some((p) => getState(p) === "running");
  const anyError = parts.some((p) => getState(p) === "error");
  // Arena-like: groups collapsed unless running
  const expanded = manuallyToggled ?? anyRunning;
  const toolName = typeof tool === "string" ? tool : "tool";

  return (
    <div className="not-prose my-1.5 overflow-hidden rounded-xl border border-white/10 bg-[#14141c]">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-white/[0.03] transition"
        onClick={() => setManuallyToggled((e) => (e === null ? false : !e))}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            anyRunning ? "bg-amber-400 animate-pulse" : anyError ? "bg-red-400" : "bg-emerald-400",
          )}
        />
        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
          {toolIcon(toolName)}
        </span>
        <span className="text-[12.5px] font-medium text-foreground/90">
          {groupLabel(toolName, parts.length)}
        </span>
        <span className="flex-1" />
        <span className="text-muted-foreground/80">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </span>
      </button>
      {expanded && (
        <div className="space-y-1 border-t border-white/5 p-1.5">
          {parts.map((part, i) => (
            <ToolCard key={i} part={part} />
          ))}
        </div>
      )}
    </div>
  );
};

export default memo(ToolGroup);
