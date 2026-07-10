import { ArrowRight, Check, ChevronDown, ChevronRight, Terminal } from "lucide-react";
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
  if (typeof s === "string") return s === "pending" ? "running" : s;
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
  if (s && typeof s === "object") out = (s as ToolState).output;
  else out = part.output;
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
    if (title) return title.length > 72 ? `${title.slice(0, 69)}…` : title;
  }
  const input = getInput(part) as Record<string, unknown> | undefined;
  if (!input) return "";
  for (const k of ["filePath", "path", "command", "pattern", "query", "description"]) {
    const v = input[k];
    if (typeof v === "string" && v) return v.length > 72 ? `${v.slice(0, 69)}…` : v;
  }
  return "";
}

function friendlyToolLabel(tool?: string): string {
  const t = (tool || "tool").toLowerCase();
  if (t === "bash" || t === "shell" || t === "cmd") return "Ran command";
  if (t === "edit" || t === "applypatch" || t === "write") return "Edited file";
  if (t === "read") return "Read file";
  if (t === "glob" || t === "grep" || t === "list" || t === "ls") return "Searched";
  if (t === "webfetch" || t === "websearch" || t === "fetch" || t === "search") return "Web";
  if (t === "task") return "Task";
  if (t === "question") return "Question";
  return tool || "Tool";
}

const stateDot: Record<string, string> = {
  running: "bg-amber-400 animate-pulse",
  pending: "bg-amber-400 animate-pulse",
  completed: "bg-emerald-400",
  error: "bg-red-400",
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

  if (questions.length === 0) return <DefaultToolCard part={part} />;

  return (
    <div
      className={cn(
        "not-prose my-1.5 overflow-hidden rounded-xl border",
        answered || !isWaiting
          ? "border-emerald-500/30 bg-emerald-500/[0.05]"
          : "border-violet-500/30 bg-violet-500/[0.05]",
      )}
    >
      {questions.map((q, qIdx) => (
        <div
          key={qIdx}
          className={cn("flex flex-col gap-2 p-3", qIdx > 0 && "border-t border-white/5")}
        >
          {q.header && (
            <div className="text-[10px] font-bold uppercase tracking-wider text-violet-300/90">
              {q.header}
            </div>
          )}
          {q.question && <div className="text-[13.5px] font-medium leading-snug">{q.question}</div>}
          {q.options && q.options.length > 0 && (
            <div className="flex flex-col gap-1">
              {q.options.map((opt, optIdx) => {
                const selected = selectedIdx[qIdx] === optIdx;
                const disabled = answered || !isWaiting;
                return (
                  <button
                    key={optIdx}
                    type="button"
                    className={cn(
                      "flex w-full flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition",
                      selected
                        ? "border-primary bg-primary/10"
                        : "border-border/80 bg-card/50 hover:border-primary/40 hover:bg-muted/40",
                      disabled && "cursor-default opacity-70",
                    )}
                    onClick={() => handleOptionClick(qIdx, optIdx, opt.label || "")}
                    disabled={disabled}
                  >
                    <span className="text-[13px] font-semibold">{opt.label}</span>
                    {opt.description && (
                      <span className="text-[11px] text-muted-foreground">{opt.description}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {q.allowCustomResponse !== false && isWaiting && !answered && (
            <div className="mt-0.5 flex items-center gap-1.5">
              <Input
                type="text"
                className="h-8 text-[13px]"
                placeholder="Или свой ответ…"
                value={customText[qIdx] || ""}
                onChange={(e) => setCustomText((prev) => ({ ...prev, [qIdx]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCustomSubmit(qIdx);
                }}
              />
              <Button
                size="icon"
                className="h-8 w-8 shrink-0 rounded-full"
                onClick={() => handleCustomSubmit(qIdx)}
                disabled={!customText[qIdx]?.trim()}
              >
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
          {answered && (
            <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
              <Check className="h-3 w-3" />
              Ответ отправлен
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function DefaultToolCard({ part }: { part: ToolPart }) {
  const state = getState(part);
  const input = fmt(getInput(part));
  const output = getOutput(part);
  const summary = getSummary(part);
  const hasBody = Boolean(input || output);
  const [manuallyToggled, setManuallyToggled] = useState<boolean | null>(null);
  // Arena-like: collapse completed tools by default
  const expanded = manuallyToggled ?? state === "running";
  const toolName = part.tool;
  const label = friendlyToolLabel(toolName);

  return (
    <div className="not-prose my-1 overflow-hidden rounded-xl border border-white/10 bg-[#14141c]">
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition",
          hasBody && "hover:bg-white/[0.03]",
        )}
        onClick={hasBody ? () => setManuallyToggled((e) => (e === null ? false : !e)) : undefined}
      >
        <span
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", stateDot[state] || stateDot.running)}
        />
        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
          {toolIcon(toolName) || <Terminal className="h-3.5 w-3.5" />}
        </span>
        <span className="text-[12.5px] font-medium text-foreground/90">{label}</span>
        {summary && (
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
            {summary}
          </span>
        )}
        {!summary && <span className="flex-1" />}
        {hasBody && (
          <span className="text-muted-foreground/80">
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </span>
        )}
      </button>
      {hasBody && expanded && (
        <div className="space-y-1.5 border-t border-white/5 px-2.5 py-2">
          {input && (
            <pre className="max-h-36 overflow-auto rounded-lg bg-black/40 p-2 font-mono text-[11px] leading-relaxed text-zinc-300/90 whitespace-pre-wrap break-all">
              {input}
            </pre>
          )}
          {output && (
            <pre className="max-h-44 overflow-auto rounded-lg bg-black/40 p-2 font-mono text-[11px] leading-relaxed text-zinc-400 whitespace-pre-wrap break-all">
              {output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

const ToolCard = ({ part }: { part: ToolPart }) => {
  if ((part.tool || "").toLowerCase() === "question") return <QuestionCard part={part} />;
  return <DefaultToolCard part={part} />;
};

export default memo(ToolCard);
