import { useState, memo } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ToolPart } from "../api/types";
import ToolCard from "./ToolCard";
import { toolIcon } from "../utils/toolUtils";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

function getState(part: ToolPart): string {
  const s = part.state;
  if (typeof s === "string") {
    return s === "pending" ? "running" : s;
  }
  if (s && typeof s === "object") {
    const status = (s as any).status ?? "running";
    return status === "pending" ? "running" : status;
  }
  return "running";
}

const stateStyles: Record<string, string> = {
  running: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  pending: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  completed: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  error: "text-red-400 bg-red-500/10 border-red-500/20",
};

const ToolGroup = ({ tool, parts }: { tool: string; parts: ToolPart[] }) => {
  const [manuallyToggled, setManuallyToggled] = useState<boolean | null>(null);
  const anyRunning = parts.some((p) => getState(p) === "running");
  const anyError = parts.some((p) => getState(p) === "error");
  const aggState = anyRunning ? "running" : anyError ? "error" : "completed";
  const toolName = typeof tool === "string" ? tool : "tool";
  const expanded = manuallyToggled ?? anyRunning;

  return (
    <div className="not-prose my-2 overflow-hidden rounded-xl border border-border bg-card/60">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition"
        onClick={() => setManuallyToggled((e) => (e === null ? false : !e))}
      >
        <span
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-md border text-[11px]",
            stateStyles[aggState] ?? stateStyles.running,
          )}
        >
          {toolIcon(toolName)}
        </span>
        <span className="text-xs font-semibold">{toolName}</span>
        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
          {parts.length}
        </Badge>
        <span className="flex-1" />
        <span className="text-muted-foreground">
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
        <span
          className={cn(
            "rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            stateStyles[aggState] ?? stateStyles.running,
          )}
        >
          {anyRunning ? "running" : aggState}
        </span>
      </button>
      {expanded && (
        <div className="space-y-1 border-t border-border p-2">
          {parts.map((part, i) => (
            <ToolCard key={i} part={part} />
          ))}
        </div>
      )}
    </div>
  );
};

export default memo(ToolGroup);
