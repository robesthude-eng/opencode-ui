import React, { useState, memo } from "react";
import { ToolPart } from "../api/types";
import ToolCard from "./ToolCard";
import { toolIcon } from "../utils/toolUtils";
import { ChevronRightIcon, ChevronDownIcon } from "./icons";

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

const ToolGroup = ({ tool, parts }: { tool: string; parts: ToolPart[] }) => {
  const [manuallyToggled, setManuallyToggled] = useState<boolean | null>(null);
  const anyRunning = parts.some((p) => getState(p) === "running");
  const anyError = parts.some((p) => getState(p) === "error");
  const aggState = anyRunning ? "running" : anyError ? "error" : "completed";
  const toolName = typeof tool === "string" ? tool : "tool";
  const expanded = manuallyToggled ?? anyRunning;

  return (
    <div className={`tool-group ${expanded ? "expanded" : "collapsed"}`}>
      <div className="tool-group-head clickable" onClick={() => setManuallyToggled((e) => (e === null ? false : !e))}>
        <span className={`tool-icon-box state-${aggState}`}>{toolIcon(toolName)}</span>
        <span className="tool-name">{toolName}</span>
        <span className="tool-count">{parts.length}</span>
        <span className="tool-spacer" />
        <span className="tool-chevron">
          {expanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
        </span>
        <span className={`tool-state state-${aggState}`}>
          {anyRunning ? "running" : aggState}
        </span>
      </div>
      {expanded && (
        <div className="tool-group-body">
          {parts.map((part, i) => (
            <ToolCard key={i} part={part} />
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(ToolGroup);
