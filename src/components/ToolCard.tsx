import React, { useState, memo, useCallback } from "react";
import { ToolPart, ToolState } from "../api/types";
import { toolIcon } from "../utils/toolUtils";
import { useStore } from "../store/useStore";
import {
  ChevronRightIcon,
  ChevronDownIcon,
} from "./icons";

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
    if (o.type === "error") return "Error: " + (o.error?.message ?? "unknown");
    return fmt(out);
  }
  return String(out);
}

function getSummary(part: ToolPart): string {
  const s = part.state;
  if (s && typeof s === "object") {
    const title = (s as ToolState).title;
    if (title) return title.length > 60 ? title.slice(0, 57) + "…" : title;
  }
  const input = getInput(part) as Record<string, unknown> | undefined;
  if (!input) return "";
  for (const k of ["filePath", "path", "command", "pattern", "query", "description"]) {
    const v = input[k];
    if (typeof v === "string" && v) return v.length > 60 ? v.slice(0, 57) + "…" : v;
  }
  return "";
}

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

  // OpenCode question tool format: { questions: [...] }
  if (Array.isArray(obj.questions)) {
    return obj.questions.map((q: any) => ({
      question: q.question || q.text || "",
      header: q.header || q.title || "",
      options: Array.isArray(q.options)
        ? q.options.map((o: any) =>
            typeof o === "string"
              ? { label: o, description: "" }
              : { label: o.label || o.text || "", description: o.description || o.desc || "", id: o.id }
          )
        : [],
      allowCustomResponse: q.allowCustomResponse ?? q.allowCustom ?? true,
    }));
  }

  // Single question format: { question: "...", options: [...] }
  if (obj.question || obj.options) {
    return [{
      question: (obj.question || obj.text || "") as string,
      header: (obj.header || obj.title || "") as string,
      options: Array.isArray(obj.options)
        ? (obj.options as any[]).map((o: any) =>
            typeof o === "string"
              ? { label: o, description: "" }
              : { label: o.label || o.text || "", description: o.description || o.desc || "", id: o.id }
          )
        : [],
      allowCustomResponse: (obj.allowCustomResponse ?? obj.allowCustom ?? true) as boolean,
    }];
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

  const handleOptionClick = useCallback((qIdx: number, optIdx: number, label: string) => {
    if (answered || !isWaiting) return;
    setSelectedIdx((prev) => ({ ...prev, [qIdx]: optIdx }));
    setAnswered(true);
    send(label);
  }, [answered, isWaiting, send]);

  const handleCustomSubmit = useCallback((qIdx: number) => {
    if (answered || !isWaiting) return;
    const text = customText[qIdx]?.trim();
    if (!text) return;
    setAnswered(true);
    send(text);
  }, [answered, isWaiting, customText, send]);

  if (questions.length === 0) {
    // Fallback to default tool card if we can't parse questions
    return <DefaultToolCard part={part} />;
  }

  return (
    <div className={`question-card ${answered ? "answered" : ""} ${!isWaiting ? "completed" : ""}`}>
      {questions.map((q, qIdx) => (
        <div key={qIdx} className="question-item">
          {q.header && <div className="question-header">{q.header}</div>}
          {q.question && <div className="question-text">{q.question}</div>}

          {q.options && q.options.length > 0 && (
            <div className="question-options">
              {q.options.map((opt, optIdx) => (
                <button
                  key={optIdx}
                  className={`question-option ${
                    selectedIdx[qIdx] === optIdx ? "selected" : ""
                  } ${answered ? "disabled" : ""}`}
                  onClick={() => handleOptionClick(qIdx, optIdx, opt.label || "")}
                  disabled={answered || !isWaiting}
                >
                  <span className="question-option-label">{opt.label}</span>
                  {opt.description && (
                    <span className="question-option-desc">{opt.description}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {q.allowCustomResponse !== false && isWaiting && !answered && (
            <div className="question-custom">
              <input
                type="text"
                className="question-custom-input"
                placeholder="Или введите свой ответ…"
                value={customText[qIdx] || ""}
                onChange={(e) => setCustomText((prev) => ({ ...prev, [qIdx]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCustomSubmit(qIdx);
                }}
              />
              <button
                className="question-custom-send"
                onClick={() => handleCustomSubmit(qIdx)}
                disabled={!customText[qIdx]?.trim()}
              >
                →
              </button>
            </div>
          )}

          {answered && (
            <div className="question-answered-hint">✓ Ответ отправлен</div>
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
    <div className={`tool state-${state} ${expanded ? "expanded" : "collapsed"}`}>
      <div
        className={`tool-head ${hasBody ? "clickable" : ""}`}
        onClick={hasBody ? () => setManuallyToggled((e) => (e === null ? false : !e)) : undefined}
      >
        <span className={`tool-icon-box state-${state}`}>{toolIcon(toolName)}</span>
        <span className="tool-name">{toolName}</span>
        {summary && <span className="tool-summary">{summary}</span>}
        <span className="tool-spacer" />
        {hasBody && (
          <span className="tool-chevron">
            {expanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
          </span>
        )}
        <span className={`tool-state state-${state}`}>{state}</span>
      </div>
      {hasBody && expanded && (
        <div className="tool-body">
          {input && (
            <details className="tool-input" open={state === "running" || state === "pending"}>
              <summary>input</summary>
              <pre>{input}</pre>
            </details>
          )}
          {output && <pre className="tool-output">{output}</pre>}
        </div>
      )}
    </div>
  );
}

/* ---------- Main ToolCard component ---------- */

const ToolCard = ({ part }: { part: ToolPart }) => {
  const toolName = part.tool?.toLowerCase() ?? "";

  // Special rendering for the "question" tool
  if (toolName === "question") {
    return <QuestionCard part={part} />;
  }

  return <DefaultToolCard part={part} />;
};

export default memo(ToolCard);
