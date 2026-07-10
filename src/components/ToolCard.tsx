import { ArrowRight, Check, ChevronDown, ChevronRight } from "lucide-react";
import { memo, useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ToolPart, ToolState } from "../api/types";
import { useStore } from "../store/useStore";
import { toolIcon } from "../utils/toolUtils";

function fmt(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getState(part: ToolPart): string {
  const s = part.state;
  if (typeof s === "string") {
    return s === "pending" ? "running" : s;
  }
  if (s && typeof s === "object") {
    const status = (s as ToolState).status ?? "running";
    return status === "pending" ? "running" : status;
  }
  return "running";
}

function getInput(part: ToolPart): unknown {
  const s = part.state;
  if (s && typeof s === "object") return (s as ToolState).input;
  return part.input;
}

function getOutput(part: ToolPart): string {
  const s = part.state;
  let out: unknown;
  if (s && typeof s === "object") {
    out = (s as ToolState).output;
  } else {
    out = part.output;
  }
  if (out == null) return "";
  if (typeof out === "string") return out;
  if (typeof out === "object") {
    const o = out as { type?: string; text?: string; error?: { message?: string } };
    if (o.type === "error") return `Error: ${o.error?.message ?? "unknown"}`;
    return fmt(out);
  }
  return String(out);
}

function getSummary(part: ToolPart): string {
  const s = part.state;
  if (s && typeof s === "object") {
    const title = (s as ToolState).title;
    if (title) return title.length > 60 ? `${title.slice(0, 57)}…` : title;
  }
  const input = getInput(part) as Record<string, unknown> | undefined;
  if (!input) return "";
  for (const k of ["filePath", "path", "command", "pattern", "query", "description"]) {
    const v = input[k];
    if (typeof v === "string" && v) return v.length > 60 ? `${v.slice(0, 57)}…` : v;
  }
  return "";
}

const stateStyles: Record<string, string> = {
  running: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  pending: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  completed: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  error: "text-red-400 bg-red-500/10 border-red-500/20",
};

/* ---------- Question tool card ---------- */

interface QuestionItem {
  question?: string;
  header?: string;
  options?: Array<{ label?: string; description?: string; id?: string }>;
  allowCustomResponse?: boolean;
}

function parseQuestions(input: unknown): QuestionItem[] {
  if (!input || typeof input !== "object") return [];
  const obj = input as Record<string, unknown>;

  if (Array.isArray(obj.questions)) {
    return obj.questions.map((q: any) => ({
      question: q.question || q.text || "",
      header: q.header || q.title || "",
      options: Array.isArray(q.options)
        ? q.options.map((o: any) =>
            typeof o === "string"
              ? { label: o, description: "" }
              : {
                  label: o.label || o.text || "",
                  description: o.description || o.desc || "",
                  id: o.id,
                },
          )
        : [],
      allowCustomResponse: q.allowCustomResponse ?? q.allowCustom ?? true,
    }));
  }

  if (obj.question || obj.options) {
    return [
      {
        question: (obj.question || obj.text || "") as string,
        header: (obj.header || obj.title || "") as string,
        options: Array.isArray(obj.options)
          ? (obj.options as any[]).map((o: any) =>
              typeof o === "string"
                ? { label: o, description: "" }
                : {
                    label: o.label || o.text || "",
                    description: o.description || o.desc || "",
                    id: o.id,
                  },
            )
          : [],
        allowCustomResponse: (obj.allowCustomResponse ?? obj.allowCustom ?? true) as boolean,
      },
    ];
  }

  return [];
}

function QuestionCard({ part }: { part: ToolPart }) {
  const input = getInput(part);
  const state = getState(part);
  const questions = parseQuestions(input);
  const send = useStore((s) => s.send);
  const [customText, setCustomText] = useState<Record<number, string>>({});
  const [answered, setAnswered] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<Record<number, number | null>>({});

  const isWaiting = state === "running";

  const handleOptionClick = useCallback(
    (qIdx: number, optIdx: number, label: string) => {
      if (answered || !isWaiting) return;
      setSelectedIdx((prev) => ({ ...prev, [qIdx]: optIdx }));
      setAnswered(true);
      send(label);
    },
    [answered, isWaiting, send],
  );

  const handleCustomSubmit = useCallback(
    (qIdx: number) => {
      if (answered || !isWaiting) return;
      const text = customText[qIdx]?.trim();
      if (!text) return;
      setAnswered(true);
      send(text);
    },
    [answered, isWaiting, customText, send],
  );

  if (questions.length === 0) {
    return <DefaultToolCard part={part} />;
  }

  return (
    <div
      className={cn(
        "not-prose my-2 overflow-hidden rounded-xl border",
        answered || !isWaiting
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-info/30 bg-info/5",
      )}
    >
      {questions.map((q, qIdx) => (
        <div
          key={qIdx}
          className={cn("flex flex-col gap-2.5 p-4", qIdx > 0 && "border-t border-border")}
        >
          {q.header && (
            <div
              className={cn(
                "text-[11px] font-bold uppercase tracking-wider",
                answered || !isWaiting ? "text-emerald-400" : "text-info",
              )}
            >
              {q.header}
            </div>
          )}
          {q.question && <div className="text-sm font-medium leading-relaxed">{q.question}</div>}

          {q.options && q.options.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {q.options.map((opt, optIdx) => {
                const selected = selectedIdx[qIdx] === optIdx;
                const disabled = answered || !isWaiting;
                return (
                  <button
                    key={optIdx}
                    type="button"
                    className={cn(
                      "flex w-full flex-col gap-0.5 rounded-xl border px-3.5 py-2.5 text-left transition",
                      selected
                        ? "border-primary bg-primary/10"
                        : "border-border bg-card hover:border-primary/50 hover:bg-muted/50",
                      disabled && !selected && "opacity-60 cursor-default",
                      disabled && "cursor-default",
                    )}
                    onClick={() => handleOptionClick(qIdx, optIdx, opt.label || "")}
                    disabled={disabled}
                  >
                    <span className="text-sm font-semibold">{opt.label}</span>
                    {opt.description && (
                      <span className="text-xs text-muted-foreground leading-snug">
                        {opt.description}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {q.allowCustomResponse !== false && isWaiting && !answered && (
            <div className="mt-1 flex items-center gap-2">
              <Input
                type="text"
                className="h-9"
                placeholder="Или введите свой ответ…"
                value={customText[qIdx] || ""}
                onChange={(e) => setCustomText((prev) => ({ ...prev, [qIdx]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCustomSubmit(qIdx);
                }}
              />
              <Button
                size="icon"
                className="h-9 w-9 shrink-0 rounded-full"
                onClick={() => handleCustomSubmit(qIdx)}
                disabled={!customText[qIdx]?.trim()}
              >
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          {answered && (
            <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
              <Check className="h-3.5 w-3.5" />
              Ответ отправлен
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------- Default tool card ---------- */

function DefaultToolCard({ part }: { part: ToolPart }) {
  const state = getState(part);
  const input = fmt(getInput(part));
  const output = getOutput(part);
  const summary = getSummary(part);
  const hasBody = Boolean(input || output);
  const [manuallyToggled, setManuallyToggled] = useState<boolean | null>(null);
  const expanded = manuallyToggled ?? state === "running";
  const toolName = part.tool;

  return (
    <div className="not-prose my-1.5 overflow-hidden rounded-xl border border-border bg-card/60">
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2",
          hasBody && "cursor-pointer hover:bg-muted/40 transition",
        )}
        onClick={hasBody ? () => setManuallyToggled((e) => (e === null ? false : !e)) : undefined}
      >
        <span
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[11px]",
            stateStyles[state] ?? stateStyles.running,
          )}
        >
          {toolIcon(toolName)}
        </span>
        <span className="text-xs font-semibold">{toolName}</span>
        {summary && (
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
            {summary}
          </span>
        )}
        {!summary && <span className="flex-1" />}
        {hasBody && (
          <span className="text-muted-foreground">
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </span>
        )}
        <span
          className={cn(
            "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide border",
            stateStyles[state] ?? stateStyles.running,
          )}
        >
          {state}
        </span>
      </div>
      {hasBody && expanded && (
        <div className="space-y-2 border-t border-border px-3 py-2">
          {input && (
            <details open={state === "running" || state === "pending"} className="group">
              <summary className="cursor-pointer list-none text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground marker:content-none [&::-webkit-details-marker]:hidden">
                input
              </summary>
              <pre className="mt-1.5 max-h-40 overflow-auto rounded-lg bg-background/80 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-all">
                {input}
              </pre>
            </details>
          )}
          {output && (
            <pre className="max-h-52 overflow-auto rounded-lg bg-background/80 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-all">
              {output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- Main ToolCard component ---------- */

const ToolCard = ({ part }: { part: ToolPart }) => {
  const toolName = part.tool?.toLowerCase() ?? "";

  if (toolName === "question") {
    return <QuestionCard part={part} />;
  }

  return <DefaultToolCard part={part} />;
};

export default memo(ToolCard);
