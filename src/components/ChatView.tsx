import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Message } from "../api/types";
import { useStore } from "../store/useStore";
import { ChevronDownIcon, SendIcon } from "./icons";
import MessageItem from "./MessageItem";

const SUGGESTIONS = [
  {
    title: "Написать код",
    prompt: "Напиши функцию на Python, которая сортирует список словарей по ключу",
    icon: "💻",
  },
  {
    title: "Объяснить код",
    prompt: "Объясни, как работает этот код: def quicksort(arr): ...",
    icon: "📖",
  },
  {
    title: "Создать файл",
    prompt: "Создай файл hello.txt с текстом 'Привет мир' используя инструмент write",
    icon: "📄",
  },
  { title: "Отладить", prompt: "Помоги найти баг в этом коде и предложи исправление", icon: "🐛" },
];

export default function ChatView() {
  const currentID = useStore((s) => s.currentID);
  const messages = useStore((s) => (currentID ? s.messages[currentID] : undefined));
  const rawStatus = useStore((s) => (currentID ? s.status[currentID] : undefined));
  const status = typeof rawStatus === "string" ? rawStatus : (rawStatus as unknown as { type?: string })?.type || "idle";
  const error = useStore((s) => s.error);
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

  const scrollRafRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
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

  useEffect(() => {
    if (atBottomRef.current) bottomRef.current?.scrollIntoView({ behavior: "auto" });
    return () => { if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current); };
  }, []);

  if (!currentID) {
    return (
      <div className="flex-1 flex items-center justify-center p-4 md:p-6 min-h-0 overflow-y-auto">
        <div className="max-w-2xl w-full text-center">
          <div className="mx-auto mb-3 md:mb-4 h-12 w-12 md:h-14 md:w-14 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white text-xl md:text-2xl shadow">
            ✦
          </div>
          <h1 className="text-xl md:text-3xl font-semibold mb-2">Чем могу помочь?</h1>
          <p className="text-sm md:text-base text-muted-foreground mb-4 md:mb-8">
            Твой персональный AI-ассистент для кода. Выбери пример или напиши свой запрос.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 md:gap-3 text-left">
            {SUGGESTIONS.map((s, i) => (
              <button
                key={i}
                className="group rounded-xl md:rounded-2xl border border-border bg-card p-3 md:p-4 hover:bg-muted/60 transition text-left"
                onClick={() => send(s.prompt)}
              >
                <div className="flex items-start gap-2 md:gap-3">
                  <span className="text-lg md:text-xl">{s.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-xs md:text-sm">{s.title}</div>
                    <div className="text-[11px] md:text-xs text-muted-foreground truncate">
                      {s.prompt.slice(0, 60)}...
                    </div>
                  </div>
                  <SendIcon size={14} />
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const hasVisibleContent = (m: Message) =>
    m.role === "assistant" &&
    m.parts.some(
      (p) =>
        (p.type === "text" && (p as { text?: string }).text) ||
        p.type === "tool" ||
        p.type === "reasoning",
    );

  const lastMsg = messages?.[messages.length - 1];
  const lastHasContent = lastMsg ? hasVisibleContent(lastMsg) : false;
  const showTyping = status === "busy" && !lastHasContent;

  const visibleMessages = (messages || []).filter(
    (m) => !showTyping || m.role !== "assistant" || hasVisibleContent(m),
  );
  
  // Group consecutive messages by role (specifically for assistant turns)
  const groupedMessages: { role: string; messages: Message[] }[] = [];
  for (const m of visibleMessages) {
    const lastGroup = groupedMessages[groupedMessages.length - 1];
    if (lastGroup && lastGroup.role === m.role && m.role === "assistant") {
      lastGroup.messages.push(m);
    } else {
      groupedMessages.push({ role: m.role, messages: [m] });
    }
  }

  const isWindowed = groupedMessages.length > windowSize;
  const renderedGroups = isWindowed ? groupedMessages.slice(-windowSize) : groupedMessages;

  return (
    <div className="flex-1 relative overflow-hidden bg-background min-h-0">
      <div className="h-full overflow-y-auto" ref={scrollRef} onScroll={onScroll}>
        {error && (
          <div className="mx-auto max-w-3xl px-3 md:px-6 pt-3">
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
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
                ↑ Показать предыдущие сообщения ({visibleMessages.length - windowSize})
              </Button>
            </div>
          )}
          <div>
            {renderedGroups.map((group, i) => {
              const isWorking = status === "busy" && group.role === "assistant" && i === renderedGroups.length - 1;
              return <MessageItem key={i} messages={group.messages} isWorking={isWorking} />;
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
            <div ref={bottomRef} />
          </div>
        </div>
      </div>
      {showScrollBtn && (
        <button
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
