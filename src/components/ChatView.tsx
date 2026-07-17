import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Message } from "../api/types";
import { useStore } from "../store/useStore";
import { ChevronDownIcon, SendIcon } from "./icons";
import MessageItem from "./MessageItem";

const SUGGESTIONS = [
  {
    title: "Написать код",
    prompt:
      "Напиши функцию на Python, которая сортирует список словарей по ключу",
    icon: "💻",
  },
  {
    title: "Объяснить код",
    prompt: "Объясни, как работает этот код: def quicksort(arr): ...",
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
  const messages = useStore((s) =>
    currentID ? s.messages[currentID] : undefined,
  );
  const rawStatus = useStore((s) =>
    currentID ? s.status[currentID] : undefined,
  );
  const status =
    typeof rawStatus === "string"
      ? rawStatus
      : (rawStatus as unknown as { type?: string })?.type || "idle";
  const error = useStore((s) => s.error);
  const selfImproveEnabled = useStore((s) => s.selfImproveEnabled);
  const selfImproveSessionId = useStore((s) => s.selfImproveSessionId);
  const testStatus = useStore((s) => s.selfImproveTestStatus);
  const testErrors = useStore((s) => s.selfImproveTestErrors);
  const send = useStore((s) => s.send);
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
  useEffect(() => {
    if (streamSignal && atBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "auto" });
    }
  }, [streamSignal]);

  // Отмена pending RAF от onScroll только при размонтировании — держим
  // отдельно от эффекта выше, иначе cleanup на каждом токене оставил бы
  // scrollRafRef в устаревшем ненулевом состоянии и заблокировал onScroll.
  useEffect(() => {
    return () => {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
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
        className="scrollbar-none h-full overflow-y-auto pb-[180px]"
        ref={scrollRef}
        onScroll={onScroll}
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
          <div>
            {renderedGroups.map((group, i) => {
              const isWorking =
                status === "busy" &&
                group.role === "assistant" &&
                i === renderedGroups.length - 1;
              const firstId = group.messages[0]?.id ?? `group-${i}`;
              return (
                <MessageItem
                  key={`${group.role}:${firstId}`}
                  messages={group.messages}
                  isWorking={isWorking}
                />
              );
            })}
            {showTyping && (
              <div className="flex gap-3 py-5 px-3 md:px-6">
                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white text-sm animate-pulse">
                  ✦
                </div>
                <div className="rounded-2xl border border-border bg-card px-4 py-3">
                  <span className="flex gap-1">
                    <span className="h-1.5 w-1.5 bg-muted-foreground rounded-full animate-bounce" />
                    <span className="h-1.5 w-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:120ms]" />
                    <span className="h-1.5 w-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:240ms]" />
                  </span>
                </div>
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
                    Внесенные изменения вызывают ошибки компил��ции или
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
      {showScrollBtn && (
        <button
          type="button"
          className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-card border border-border shadow-lg p-2 hover:bg-muted transition"
          onClick={scrollToBottom}
          title="К последнему сообщению"
        >
          <ChevronDownIcon size={18} />
        </button>
      )}
    </div>
  );
}
