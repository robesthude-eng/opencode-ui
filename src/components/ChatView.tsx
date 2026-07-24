import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { statusText } from "../api/eventGuards";
import type { Message, ToolPart } from "../api/types";
import { messageText } from "../lib/chatText";
import { useStore } from "../store/useStore";
import AgentIndicator from "./AgentIndicator";
import { ChevronDownIcon, SendIcon } from "./icons";
import MessageItem from "./MessageItem";

/** Человечная подпись текущего действия для индикатора работы агента. */
function toolActivityLabel(tool: unknown): string {
  const t = (typeof tool === "string" ? tool : "").toLowerCase();
  if (["bash", "shell", "cmd"].includes(t)) return "выполняет команду…";
  if (["write"].includes(t)) return "создаёт файл…";
  if (["edit", "multiedit", "patch", "apply_patch"].includes(t))
    return "редактирует файл…";
  if (["read", "grep", "glob", "list", "ls"].includes(t))
    return "читает файлы…";
  if (t.includes("todo")) return "обновляет план…";
  if (["webfetch", "websearch", "fetch"].includes(t))
    return "ищет в интернете…";
  if (t === "question") return "задаёт вопрос…";
  if (t === "task") return "запускает подзадачу…";
  return "выполняет действие…";
}

/**
 * Определяет текущую фазу работы агента по последней части
 * последнего assistant-сообщения: инструмент в работе → его подпись,
 * размышление → «думает…», текст → «пишет ответ…».
 */
function currentActivityLabel(messages: Message[] | undefined): string {
  const list = messages ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (!m || m.role !== "assistant") continue;
    const parts = m.parts ?? [];
    for (let j = parts.length - 1; j >= 0; j--) {
      const p = parts[j] as {
        type?: string;
        tool?: unknown;
        state?: unknown;
        output?: unknown;
        text?: unknown;
      };
      if (!p) continue;
      if (p.type === "tool") {
        const st = p.state;
        const raw =
          typeof st === "string"
            ? st
            : st && typeof st === "object"
              ? ((st as { status?: string }).status ?? "running")
              : p.output != null
                ? "completed"
                : "running";
        const norm = raw === "pending" ? "running" : raw;
        if (norm === "running") return toolActivityLabel(p.tool);
        // Инструмент завершён — агент решает следующий шаг.
        return "думает…";
      }
      if (p.type === "reasoning") return "думает…";
      if (p.type === "text" && p.text) return "пишет ответ…";
    }
    return "думает…";
  }
  return "думает…";
}

/** «шаг N» — номер текущего действия агента в текущем ответе (как в мокапе). */
function currentStepMeta(messages: Message[] | undefined): string | undefined {
  const list = messages ?? [];
  const last = list[list.length - 1];
  if (!last || last.role !== "assistant") return undefined;
  const tools = (last.parts ?? []).filter(
    (p) => (p as { type?: string }).type === "tool",
  );
  if (tools.length === 0) return undefined;
  return `шаг ${tools.length}`;
}

const SUGGESTIONS = [
  {
    title: "Написать код",
    prompt:
      "Напиши функцию на Python, которая сортирует список словарей по ключу",
    icon: "💻",
  },
  {
    title: "Объяснить код",
    prompt:
      "Объясни, как работает этот код:\n\ndef quicksort(arr):\n    if len(arr) <= 1:\n        return arr\n    pivot = arr[len(arr) // 2]\n    left = [x for x in arr if x < pivot]\n    mid = [x for x in arr if x == pivot]\n    right = [x for x in arr if x > pivot]\n    return quicksort(left) + mid + quicksort(right)",
    icon: "📖",
  },
  {
    title: "Создать файл",
    prompt:
      "Создай файл hello.txt с текстом 'Привет мир' используя инструмент write",
    icon: "📄",
  },
  {
    title: "Отладить",
    prompt: "Помоги найти баг в этом коде и предложи исправление",
    icon: "🐛",
  },
];

const hasVisibleContent = (m: Message) =>
  m.role === "assistant" &&
  m.parts.some(
    (p) =>
      (p.type === "text" && (p as { text?: string }).text) ||
      p.type === "tool" ||
      p.type === "reasoning",
  );

export default function ChatView() {
  const currentID = useStore((s) => s.currentID);
  const messages = useStore(
    useShallow((s) => (currentID ? s.messages[currentID] : undefined)),
  );
  const rawStatus = useStore((s) =>
    currentID ? s.status[currentID] : undefined,
  );
  const status = statusText(rawStatus);
  const error = useStore((s) => s.error);
  const selfImproveEnabled = useStore((s) => s.selfImproveEnabled);
  const selfImproveSessionId = useStore((s) => s.selfImproveSessionId);
  const testStatus = useStore((s) => s.selfImproveTestStatus);
  const testErrors = useStore((s) => s.selfImproveTestErrors);
  const send = useStore((s) => s.send);
  const prefillComposer = useStore((s) => s.prefillComposer);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const [windowSize, setWindowSize] = useState(40);
  const [isScrolledUp, setIsScrolledUp] = useState(false);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    atBottomRef.current = true;
    setIsScrolledUp(false);
  };

  const scrollRafRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(
    null,
  );
  const onScroll = () => {
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const el = scrollRef.current;
      if (!el) return;
      const isUp = el.scrollHeight - el.scrollTop - el.clientHeight >= 80;
      atBottomRef.current = !isUp;
      if (isScrolledUp !== isUp) setIsScrolledUp(isUp);
    });
  };

  const showScrollBtn = isScrolledUp && messages && messages.length > 0;

  // Дешёвый сигнал, меняющийся при любом приросте контента: новое сообщение
  // ИЛИ дописанные в последнее сообщение токены (растёт суммарная длина текста).
  // Раньше автоскролл висел в mount-only эффекте ([] deps) и срабатывал один раз,
  // поэтому во время стрима ответ «уезжал» вниз, а пользователь оставался наверху.
  const streamSignal = useMemo(() => {
    if (!messages || messages.length === 0) return "";
    const last = messages[messages.length - 1];
    const textLen =
      last?.parts?.reduce((n, p) => {
        const anyP = p as {
          text?: string;
          state?: { output?: unknown } | string;
        };
        // P2-fix: учитываем и растущий вывод инструментов — иначе
        // автоскролл не следует за длинным выводом команд.
        const state =
          typeof anyP.state === "object" && anyP.state !== null
            ? anyP.state
            : undefined;
        const outLen =
          typeof state?.output === "string" ? state.output.length : 0;
        return n + (anyP.text?.length ?? 0) + outLen;
      }, 0) ?? 0;
    return `${messages.length}:${last?.id ?? ""}:${last?.parts?.length ?? 0}:${textLen}`;
  }, [messages]);

  // Автоскролл к низу по мере стрима — но ТОЛЬКО если пользователь уже внизу.
  // Если он прокрутил вверх читать историю, позицию не трогаем (появляется
  // кнопка «вниз»). Programmatic scroll сам поднимет onScroll и обновит
  // atBottomRef/isScrolledUp консистентно. behavior:"auto" — мгновенно, чтобы
  // не отставать от токенов.
  // P2-fix: троттлинг через rAF — стор может обновиться несколько раз
  // за кадр, а scrollIntoView каждый раз форсирует layout. Коалесцируем
  // все срабатывания в один скролл на кадр; позицию «внизу»
  // перепроверяем уже в момент кадра.
  const autoScrollRafRef = useRef<ReturnType<
    typeof requestAnimationFrame
  > | null>(null);
  useEffect(() => {
    if (!streamSignal || !atBottomRef.current) return;
    if (autoScrollRafRef.current !== null) return;
    autoScrollRafRef.current = requestAnimationFrame(() => {
      autoScrollRafRef.current = null;
      if (atBottomRef.current) {
        bottomRef.current?.scrollIntoView({ behavior: "auto" });
      }
    });
  }, [streamSignal]);

  // Отмена pending RAF от onScroll только при размонтировании — держим
  // отдельно от эффекта выше, иначе cleanup на каждом токене оставил бы
  // scrollRafRef в устаревшем ненулевом состоянии и заблокировал onScroll.
  useEffect(() => {
    return () => {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
      if (autoScrollRafRef.current !== null) {
        cancelAnimationFrame(autoScrollRafRef.current);
      }
    };
  }, []);

  const lastMsg = messages?.[messages.length - 1];
  const lastHasContent = lastMsg ? hasVisibleContent(lastMsg) : false;
  const showTyping = status === "busy" && !lastHasContent;

  const visibleMessages = useMemo(
    () =>
      (messages || []).filter(
        (m) => !showTyping || m.role !== "assistant" || hasVisibleContent(m),
      ),
    [messages, showTyping],
  );

  // Group consecutive messages by role (specifically for assistant turns).
  // Memoizing this avoids rebuilding markdown input on scroll/status-only renders.
  const groupedMessages = useMemo(() => {
    const groups: { role: string; messages: Message[] }[] = [];
    for (const m of visibleMessages) {
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.role === m.role && m.role === "assistant") {
        lastGroup.messages.push(m);
      } else {
        groups.push({ role: m.role, messages: [m] });
      }
    }
    return groups;
  }, [visibleMessages]);

  const isWindowed = groupedMessages.length > windowSize;
  const renderedGroups = useMemo(
    () => (isWindowed ? groupedMessages.slice(-windowSize) : groupedMessages),
    [groupedMessages, isWindowed, windowSize],
  );

  // Поиск по сообщениям чата (Ctrl+F или кнопка в верхней панели).
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIdx, setSearchIdx] = useState(0);

  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return (messages || [])
      .filter((m) => messageText(m).toLowerCase().includes(q))
      .map((m) => m.id);
  }, [messages, searchQuery]);

  const jumpToMessage = (mid: string) => {
    const find = () =>
      scrollRef.current?.querySelector(`[data-mids~="${mid}"]`);
    const el = find();
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    // Сообщение за пределами окна — разворачиваем историю и скроллим.
    setWindowSize(100000);
    setTimeout(() => {
      find()?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
  };

  const goToMatch = (idx: number) => {
    const total = searchMatches.length;
    if (total === 0) return;
    const n = ((idx % total) + total) % total;
    setSearchIdx(n);
    const mid = searchMatches[n];
    if (mid) jumpToMessage(mid);
  };

  useEffect(() => {
    const openSearch = () => setSearchOpen(true);
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === "KeyF") {
        e.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("opencode:chat-search", openSearch);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("opencode:chat-search", openSearch);
    };
  }, []);

  // Текст последнего запроса пользователя — для «Спросить ещё раз»
  // и «Изменить последний запрос».
  const lastUserText = useMemo(() => {
    for (let i = (messages?.length ?? 0) - 1; i >= 0; i--) {
      const m = messages?.[i];
      if (m?.role === "user") {
        const t = messageText(m).trim();
        if (t) return t;
      }
    }
    return null;
  }, [messages]);

  // Первый инструмент, завершившийся ошибкой, — для чипа перехода к сбою.
  const failedToolMid = useMemo(() => {
    for (const m of messages ?? []) {
      for (const p of m.parts ?? []) {
        if (p.type !== "tool") continue;
        const st = (p as ToolPart).state;
        const status =
          typeof st === "string"
            ? st
            : st && typeof st === "object"
              ? st.status
              : undefined;
        if (status === "error" || status === "failed") return m.id;
      }
    }
    return null;
  }, [messages]);

  // Цитирование выделенного текста: кнопка появляется под выделением.
  const [quoteSel, setQuoteSel] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);

  const handleSelectionEnd = () => {
    const sel = window.getSelection();
    const textSel = sel?.toString().trim() ?? "";
    if (!sel || sel.isCollapsed || !textSel) {
      setQuoteSel(null);
      return;
    }
    const node = sel.anchorNode;
    const host = scrollRef.current;
    if (!node || !host || !host.contains(node)) {
      setQuoteSel(null);
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    setQuoteSel({
      x: Math.min(Math.max(rect.left - hostRect.left, 8), hostRect.width - 200),
      y: Math.min(rect.bottom - hostRect.top + 6, hostRect.height - 40),
      text: textSel.slice(0, 2000),
    });
  };

  const quoteToComposer = () => {
    if (!quoteSel) return;
    const quoted = quoteSel.text
      .split("\n")
      .map((l) => `> ${l}`)
      .join("\n");
    prefillComposer(`${quoted}\n\n`);
    setQuoteSel(null);
    window.getSelection()?.removeAllRanges();
  };

  if (!currentID) {
    return (
      <div className="flex-1 flex items-center justify-center p-4 md:p-6 min-h-0 overflow-y-auto">
        <div className="max-w-3xl w-full text-center px-3 md:px-6">
          <h1 className="text-xl md:text-3xl font-semibold mb-2">
            Чем могу помочь?
          </h1>
          <p className="text-sm md:text-base text-muted-foreground">
            Твой персональный AI-ассистент для кода. Напиши свой запрос.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 relative min-h-0 overflow-hidden bg-transparent">
      <div
        key={currentID}
        className="oc-chat-in scrollbar-none h-full overflow-y-auto pb-[180px]"
        ref={scrollRef}
        onScroll={onScroll}
        onMouseUp={handleSelectionEnd}
      >
        {error && (
          <div className="mx-auto max-w-3xl px-3 md:px-6 pt-3">
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {typeof error === "string" ? error : JSON.stringify(error)}
            </div>
          </div>
        )}
        <div className="mx-auto max-w-3xl">
          {(!messages || messages.length === 0) && status !== "busy" && (
            <p className="text-center text-muted-foreground py-12">
              Начни диалог — напиши сообщение ниже
            </p>
          )}
          {isWindowed && (
            <div className="text-center py-3">
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => setWindowSize((s) => s + 40)}
              >
                ↑ Показать предыдущие сообщения (
                {visibleMessages.length - windowSize})
              </Button>
            </div>
          )}
          {failedToolMid && status !== "busy" && (
            <div className="text-center py-1">
              <Button
                variant="outline"
                size="sm"
                className="rounded-full border-red-500/40 text-red-400 hover:text-red-300"
                onClick={() => jumpToMessage(failedToolMid)}
              >
                ⚠️ Инструмент завершился с ошибкой — показать
              </Button>
            </div>
          )}
          <div>
            {renderedGroups.map((group, i) => {
              const isWorking =
                status === "busy" &&
                group.role === "assistant" &&
                i === renderedGroups.length - 1;
              const firstId = group.messages[0]?.id ?? `group-${i}`;
              const mids = group.messages.map((m) => m.id).join(" ");
              return (
                <div key={`${group.role}:${firstId}`} data-mids={mids}>
                  <MessageItem
                    messages={group.messages}
                    isWorking={isWorking}
                  />
                </div>
              );
            })}
            {status !== "busy" &&
              lastUserText &&
              lastMsg?.role === "assistant" && (
                <div className="flex flex-wrap gap-2 px-3 pb-3 md:px-6">
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    onClick={() => send(lastUserText).catch(() => {})}
                  >
                    ↻ Спросить ещё раз
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    onClick={() => prefillComposer(lastUserText)}
                  >
                    ✏️ Изменить последний запрос
                  </Button>
                </div>
              )}
            {status === "busy" && (
              <div className="flex gap-3 py-5 px-3 md:px-6">
                <AgentIndicator
                  label={currentActivityLabel(messages)}
                  meta={currentStepMeta(messages)}
                />
              </div>
            )}
            {selfImproveEnabled &&
              currentID === selfImproveSessionId &&
              testStatus === "failure" &&
              testErrors.length > 0 && (
                <div className="mx-auto max-w-2xl my-4 rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 shadow-sm not-prose">
                  <div className="flex items-center gap-2 text-rose-400 font-semibold mb-2 text-sm">
                    <span className="text-lg">🐛</span>
                    <span>Сбой автоматического тестирования песочницы</span>
                  </div>
                  <p className="text-xs text-muted-foreground/80 mb-3">
                    Внесенные изменения вызывают ошибки компиляции или
                    заваливают автотесты Vitest. Лог ошибок:
                  </p>
                  <pre className="overflow-x-auto rounded-lg bg-black/40 p-3 font-mono text-[12px] leading-relaxed text-rose-300 max-h-60 border border-black/10 whitespace-pre-wrap break-all">
                    {testErrors.join("\n")}
                  </pre>
                </div>
              )}
            <div ref={bottomRef} />
          </div>
        </div>
      </div>
      {quoteSel && (
        <button
          type="button"
          className="absolute z-20 rounded-full border border-border bg-card px-3 py-1 text-xs shadow-lg hover:bg-accent"
          style={{ left: quoteSel.x, top: quoteSel.y }}
          onClick={quoteToComposer}
        >
          💬 Ответить с цитатой
        </button>
      )}
      {searchOpen && (
        <div className="absolute right-3 top-2 z-20 flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 shadow-lg">
          <input
            ref={(el) => el?.focus()}
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSearchIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") goToMatch(searchIdx + 1);
              if (e.key === "Escape") setSearchOpen(false);
            }}
            placeholder="Поиск по чату…"
            aria-label="Поиск по сообщениям чата"
            className="w-40 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
          />
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {searchMatches.length > 0
              ? `${(searchIdx % searchMatches.length) + 1}/${searchMatches.length}`
              : "0/0"}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title="Предыдущее совпадение"
            aria-label="Предыдущее совпадение"
            onClick={() => goToMatch(searchIdx - 1)}
          >
            ↑
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title="Следующее совпадение"
            aria-label="Следующее совпадение"
            onClick={() => goToMatch(searchIdx + 1)}
          >
            ↓
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title="Закрыть поиск"
            aria-label="Закрыть поиск"
            onClick={() => setSearchOpen(false)}
          >
            ✕
          </Button>
        </div>
      )}
      {showScrollBtn && (
        <button
          type="button"
          className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-card border border-border shadow-lg p-2 hover:bg-muted transition"
          onClick={scrollToBottom}
          title="К последнему сообщению"
          aria-label="К последнему сообщению"
        >
          <ChevronDownIcon size={18} />
        </button>
      )}
    </div>
  );
}
