import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Terminal,
} from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { api } from "../api/client";
import type { ToolPart, ToolState } from "../api/types";
import { useSmoothStreamingText } from "../lib/useSmoothText";
import { sessionFsm } from "../store/sessionFsm";
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
  if (part.output !== undefined && part.output !== null) {
    return "completed";
  }
  return "running";
}

function getTime(part: ToolPart): { start?: number; end?: number } {
  const s = part.state;
  if (s && typeof s === "object") return (s as ToolState).time || {};
  return {};
}

/** Live "1.8s" / "3s" duration label. Ticks while running, freezes once ended. */
function useDuration(
  time: { start?: number; end?: number },
  running: boolean,
): string | null {
  const [, setTick] = useState(0);
  // Если сервер не прислал time.end, фиксируем момент завершения сами:
  // иначе значение либо «плывёт» (Date.now() при каждом рендере),
  // либо зависает на устаревшем числе до следующего клика.
  const frozenEndRef = useRef<number | null>(null);
  if (running) {
    frozenEndRef.current = null;
  } else if (time.start && !time.end && frozenEndRef.current === null) {
    frozenEndRef.current = Date.now();
  }
  useEffect(() => {
    if (!running || !time.start) return;
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, [running, time.start]);
  if (!time.start) return null;
  const end = running
    ? Date.now()
    : (time.end ?? frozenEndRef.current ?? Date.now());
  const secs = Math.max(0, (end - time.start) / 1000);
  return secs < 10 ? `${secs.toFixed(1)}s` : `${Math.round(secs)}s`;
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
  if (out == null && s && typeof s === "object") {
    // Стриминг: пока инструмент работает, промежуточный stdout
    // приходит в state.metadata.output — показываем его живьём,
    // не дожидаясь финального state.output.
    const meta = (s as ToolState).metadata;
    if (meta && typeof meta.output === "string") out = meta.output;
  }
  if (out == null) return "";
  if (typeof out === "string") return out;
  if (typeof out === "object") {
    const o = out as { type?: string; text?: string; error?: unknown };
    if (o.type === "error") {
      const errMsg =
        typeof o.error === "string"
          ? o.error
          : o.error && typeof (o.error as any).message === "string"
            ? (o.error as any).message
            : JSON.stringify(o.error ?? "unknown");
      return `Error: ${errMsg}`;
    }
    return fmt(out);
  }
  return String(out);
}

/** «/app/workspace/foo/bar.ts» → «bar.ts». */
function baseName(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, "");
  const segments = trimmed.split(/[\\/]/);
  return segments[segments.length - 1] || trimmed;
}

/** Строка похожа на путь к файлу: есть разделители и нет пробелов. */
function looksLikePath(v: string): boolean {
  return /[\\/]/.test(v) && !/\s/.test(v);
}

function getSummary(part: ToolPart): string {
  const clip = (v: string) => (v.length > 72 ? `${v.slice(0, 69)}…` : v);
  const s = part.state;
  if (s && typeof s === "object") {
    const title = (s as ToolState).title;
    // В строке действия показываем только имя файла, без полного пути.
    if (title) return clip(looksLikePath(title) ? baseName(title) : title);
  }
  const input = getInput(part) as Record<string, unknown> | undefined;
  if (!input) return "";
  for (const k of ["filePath", "path"]) {
    const v = input[k];
    if (typeof v === "string" && v) return clip(baseName(v));
  }
  for (const k of ["command", "pattern", "query", "description"]) {
    const v = input[k];
    if (typeof v === "string" && v) return clip(v);
  }
  return "";
}

function friendlyToolLabel(tool?: string): string {
  const t = (tool || "").toLowerCase();
  if (t === "bash" || t === "shell" || t === "cmd") return "used Bash";
  if (t === "read") return "Read file";
  if (t === "write") return "Wrote file";
  if (t === "edit" || t === "applypatch") return "Edited file";
  if (t === "glob") return "Searched files";
  if (t === "grep") return "Searched text";
  if (t === "ls" || t === "list") return "Listed directory";
  if (t === "webfetch" || t === "fetch") return "Fetched URL";
  if (t === "task") return "Ran subtask";
  if (t === "todowrite" || t === "todo") return "Updated todos";
  if (t === "question") return "Question";
  if (!tool) return "Tool";
  return "used " + tool.charAt(0).toUpperCase() + tool.slice(1);
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
  if (Array.isArray(obj.questions)) {
    // biome-ignore lint/suspicious/noExplicitAny: question structure is dynamic
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
        allowCustomResponse: (obj.allowCustomResponse ??
          obj.allowCustom ??
          true) as boolean,
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
  const currentID = useStore((s) => s.currentID);
  const [customText, setCustomText] = useState<Record<number, string>>({});
  // Статус «отвечено» — по каждому вопросу отдельно (раньше был один
  // флаг на всю карточку, и ответ на один вопрос помечал «Ответ отправлен»
  // сразу у всех).
  const [answeredIdx, setAnsweredIdx] = useState<Record<number, boolean>>({});
  const [selectedIdx, setSelectedIdx] = useState<Record<number, number | null>>(
    {},
  );
  const isWaiting = state === "running";

  // UX-fix: правильный способ ответить на интерактивный tool "question" —
  // это POST /api/session/:sid/question/:que_id/reply, а не новый /message.
  // Иначе LLM получает два user-message подряд без tool_result и весь turn виснет.
  // Пытаемся найти requestID (que_...) в структуре part'а: OpenCode кладёт его либо
  // в part.state.callID, либо в part.callID, либо в part.request.id.
  async function submitAnswer(labels: string[], q?: QuestionItem) {
    const sid = currentID;
    // Контекст вопроса в тексте ответа — чтобы агент понимал, на какой
    // из нескольких вопросов ответил пользователь.
    const ctx = q?.header || q?.question || "";
    const answerText = ctx ? `${ctx}: ${labels.join(", ")}` : labels.join(", ");

    // Стратегия 1: пробуем v2 QuestionAPI (только если сервер реально создал pending question)
    if (sid) {
      try {
        const list = await api.listPendingQuestions(sid);
        const pending = list?.data?.[0];
        if (pending?.id && /^que/.test(pending.id)) {
          await api.replyQuestion(sid, pending.id, [labels]);
          return; // сервер сам продолжит turn через SSE
        }
      } catch (e) {
        console.warn("[QuestionCard] v2 question API not available:", e);
      }
    }

    // Стратегия 2 (main path): tool question — legacy, живёт в parts сообщения.
    // Правильно: сначала abort() зависший turn (чтобы сервер закрыл tool с error),
    // потом отправить ответ обычным user-message. Без abort() два user-message подряд
    // без tool_result вешают LLM-контракт (два user в ряд запрещены).
    if (sid) {
      try {
        await api.abortSession(sid);
        // маленькая пауза, чтобы сервер успел записать abort в БД��
        await sessionFsm.waitForIdle(sid, 3000);
      } catch (e) {
        console.warn("[QuestionCard] abortSession failed (ok, продолжаем):", e);
      }
    }

    await Promise.resolve(send(answerText));
  }

  const handleOptionClick = useCallback(
    (qIdx: number, optIdx: number, label: string) => {
      if (answeredIdx[qIdx]) return;
      setSelectedIdx((prev) => ({ ...prev, [qIdx]: optIdx }));
      setAnsweredIdx((prev) => ({ ...prev, [qIdx]: true }));
      submitAnswer([label], questions[qIdx]).catch((err) => {
        console.error("[QuestionCard] submitAnswer failed:", err);
        setAnsweredIdx((prev) => ({ ...prev, [qIdx]: false }));
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [answeredIdx, submitAnswer],
  );

  const handleCustomSubmit = useCallback(
    (qIdx: number) => {
      if (answeredIdx[qIdx]) return;
      const text = customText[qIdx]?.trim();
      if (!text) return;
      setAnsweredIdx((prev) => ({ ...prev, [qIdx]: true }));
      submitAnswer([text], questions[qIdx]).catch((err) => {
        console.error("[QuestionCard] submitAnswer failed:", err);
        setAnsweredIdx((prev) => ({ ...prev, [qIdx]: false }));
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [answeredIdx, customText, submitAnswer],
  );

  if (questions.length === 0) return <DefaultToolCard part={part} />;

  // По одному вопросу за раз: видны отвеченные и первый неотвеченный;
  // остальные появляются после ответа.
  const firstUnanswered = questions.findIndex((_, i) => !answeredIdx[i]);
  const allAnswered = firstUnanswered === -1;
  const hiddenCount = allAnswered ? 0 : questions.length - firstUnanswered - 1;

  return (
    <div
      className={cn(
        "not-prose my-1.5 overflow-hidden rounded-xl border",
        allAnswered || !isWaiting
          ? "border-emerald-500/30 bg-emerald-500/[0.05]"
          : "border-emerald-400/30 bg-emerald-400/[0.05]",
      )}
    >
      {questions.map((q, qIdx) => {
        const isAnswered = !!answeredIdx[qIdx];
        if (!isAnswered && qIdx !== firstUnanswered) return null;
        return (
          <div
            key={qIdx}
            className={cn(
              "flex flex-col gap-2 p-3",
              qIdx > 0 && "border-t border-border",
            )}
          >
            {q.header && (
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-300/90">
                {q.header}
              </div>
            )}
            {q.question && (
              <div className="text-[13.5px] font-medium leading-snug">
                {q.question}
              </div>
            )}
            {q.options && q.options.length > 0 && (
              <div className="flex flex-col gap-1">
                {q.options.map((opt, optIdx) => {
                  const selected = selectedIdx[qIdx] === optIdx;
                  const disabled = isAnswered;
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
                      onClick={() =>
                        handleOptionClick(qIdx, optIdx, opt.label || "")
                      }
                      disabled={disabled}
                    >
                      <span className="text-[13px] font-semibold">
                        {opt.label}
                      </span>
                      {opt.description && (
                        <span className="text-[11px] text-muted-foreground">
                          {opt.description}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            {q.allowCustomResponse !== false && isWaiting && !isAnswered && (
              <div className="mt-0.5 flex items-center gap-1.5">
                <Input
                  type="text"
                  className="h-8 text-[13px]"
                  placeholder="Или свой ответ…"
                  value={customText[qIdx] || ""}
                  onChange={(e) =>
                    setCustomText((prev) => ({
                      ...prev,
                      [qIdx]: e.target.value,
                    }))
                  }
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
            {isAnswered && (
              <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                <Check className="h-3 w-3" />
                Ответ отправлен
              </div>
            )}
          </div>
        );
      })}
      {hiddenCount > 0 && (
        <div className="border-t border-border px-3 py-2 font-mono text-[11px] text-muted-foreground/60">
          Следующий вопрос появится после ответа · осталось {hiddenCount}
        </div>
      )}
    </div>
  );
}

function CodeBlock({
  label,
  text,
  streaming,
}: {
  label: string;
  text: string;
  streaming?: boolean;
}) {
  // Плавный вывод: во время стрима текст догоняет цель постепенно
  // (вместо скачков пачками), а pre автопрокручивается к последним строкам.
  const shown = useSmoothStreamingText(text, !!streaming);
  const preRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    if (streaming && preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [streaming, shown]);
  const [copied, setCopied] = useState(false);
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => {});
  };
  return (
    <div
      className="rounded-lg border border-border overflow-hidden"
      style={{
        background: "color-mix(in srgb, var(--color-card) 100%, white 4%)",
      }}
    >
      <div
        className="flex items-center justify-between px-2.5 py-1 border-b border-border/70"
        style={{
          background: "color-mix(in srgb, var(--color-card) 100%, white 8%)",
        }}
      >
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          {label}
        </span>
        <button
          type="button"
          onClick={copy}
          className="p-1 rounded hover:bg-accent/60 text-muted-foreground/60 hover:text-foreground transition"
          title="Copy"
          aria-label="Copy"
        >
          {copied ? (
            <Check className="h-3 w-3 text-emerald-500" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </button>
      </div>
      <pre
        ref={preRef}
        className="max-h-56 overflow-auto p-2.5 font-mono text-[11.5px] leading-relaxed text-foreground/85 whitespace-pre-wrap break-all"
      >
        {shown}
        {streaming && <span className="streaming-cursor" />}
      </pre>
    </div>
  );
}

function DefaultToolCard({ part }: { part: ToolPart }) {
  const state = getState(part);
  const running = state === "running";
  const errored = state === "error";
  const input = fmt(getInput(part));
  const output = getOutput(part);
  const summary = getSummary(part);
  // Пока модель генерирует аргументы вызова, сервер отдаёт пустой input ({}):
  // частичный JSON аргументов распарсить нельзя, поэтому вместо «{}»
  // показываем честный плейсхолдер «Генерирует содержимое…».
  const inputPending = running && (!input || input === "{}");
  const hasBody = Boolean(input || output || inputPending);
  const duration = useDuration(getTime(part), running);
  const [manuallyToggled, setManuallyToggled] = useState<boolean | null>(null);
  const expanded = manuallyToggled ?? running;
  // Defensive: opencode may send an object {messageID, callID} in `tool` field
  // during streaming. After store normalization this should never reach UI,
  // but if anything slips through, fall back to undefined rather than
  // crashing with React error #31 (Objects are not valid as a React child).
  const toolName =
    typeof part.tool === "string" && part.tool ? part.tool : undefined;
  const label = friendlyToolLabel(toolName);
  const isBash = ["bash", "shell", "cmd"].includes(
    (toolName || "").toLowerCase(),
  );

  return (
    <div className="not-prose my-1 oc-msg-in">
      {/* Ghost-строка заголовка tool: прозрачная, минимальная */}
      <button
        type="button"
        className={cn(
          "group/tool flex w-full items-center gap-2 px-2 py-1.5 text-left rounded-lg transition",
          hasBody && "hover:bg-accent/30 cursor-pointer",
          !hasBody && "cursor-default",
        )}
        // Один клик всегда переключает относительно видимого состояния.
        // Старая логика (null → false) требовала двойного клика после
        // завершения действия: первый клик лишь фиксировал «свернуто».
        onClick={hasBody ? () => setManuallyToggled(!expanded) : undefined}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
          {toolIcon(toolName) || <Terminal className="h-3 w-3" />}
        </span>
        {/* Название */}
        <span className="text-[13px] font-medium text-foreground/85">
          {label}
        </span>
        {/* Статус: ✓ или ● или ✕ */}
        {running && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400 animate-pulse" />
        )}
        {!running && !errored && (
          <Check
            className="h-3.5 w-3.5 shrink-0 text-emerald-500"
            strokeWidth={2.5}
          />
        )}
        {errored && (
          <span className="text-[11px] font-medium text-red-400">error</span>
        )}
        {/* Duration */}
        {duration && (
          <span className="text-[11.5px] text-muted-foreground/70">
            {duration}
          </span>
        )}
        {/* Summary inline (обрезается) */}
        {summary && (
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground/70">
            {summary}
          </span>
        )}
        {!summary && <span className="flex-1" />}
        {/* Chevron */}
        {hasBody && (
          <span className="text-muted-foreground/50 shrink-0">
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </span>
        )}
      </button>

      {/* Раскрытые секции в стиле Arena: COMMAND / STDOUT etc */}
      {hasBody && expanded && (
        <div className="mt-1.5 ml-6 space-y-1.5">
          {inputPending ? (
            <div className="flex items-center gap-2 px-1 py-1 text-[12px] text-muted-foreground/70">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400 animate-pulse" />
              Генерирует содержимое…
            </div>
          ) : (
            input &&
            input !== "{}" && (
              <CodeBlock
                label={isBash ? "COMMAND" : "INPUT"}
                text={input}
                streaming={running}
              />
            )
          )}
          {output && (
            <CodeBlock
              label={isBash ? "STDOUT" : "OUTPUT"}
              text={output}
              streaming={running}
            />
          )}
        </div>
      )}
    </div>
  );
}

const ToolCard = ({ part }: { part: ToolPart }) => {
  const toolName = typeof part.tool === "string" ? part.tool : "";
  if (toolName.toLowerCase() === "question")
    return <QuestionCard part={part} />;
  return <DefaultToolCard part={part} />;
};

export default memo(ToolCard);
