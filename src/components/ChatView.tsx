import { useEffect, useRef, useState } from "react";
import { useStore } from "../store/useStore";
import MessageItem from "./MessageItem";
import { ChevronDownIcon, SendIcon } from "./icons";
import type { Message } from "../api/types";

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
  {
    title: "Отладить",
    prompt: "Помоги найти баг в этом коде и предложи исправление",
    icon: "🐛",
  },
];

export default function ChatView() {
  const currentID = useStore((s) => s.currentID);
  const messages = useStore((s) => (currentID ? s.messages[currentID] : undefined));
  const rawStatus = useStore((s) => (currentID ? s.status[currentID] : undefined));
  const status = typeof rawStatus === "string" ? rawStatus : (rawStatus as any)?.type || "idle";
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

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const isUp = el.scrollHeight - el.scrollTop - el.clientHeight >= 80;
    atBottomRef.current = !isUp;
    if (isScrolledUp !== isUp) {
      setIsScrolledUp(isUp);
    }
  };

  const showScrollBtn = isScrolledUp && messages && messages.length > 0;

  useEffect(() => {
    if (atBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, status]);

  if (!currentID) {
    return (
      <div className="chat empty">
        <div className="welcome-claude">
          <div className="welcome-logo">
            <span className="welcome-logo-icon">✦</span>
          </div>
          <h1>Чем могу помочь?</h1>
          <p className="welcome-subtitle muted">
            Твой персональный AI-ассистент для кода. Выбери пример или напиши свой запрос.
          </p>
          
          <div className="suggestions-grid">
            {SUGGESTIONS.map((s, i) => (
              <button
                key={i}
                className="suggestion-card"
                onClick={() => send(s.prompt)}
              >
                <span className="suggestion-icon">{s.icon}</span>
                <div className="suggestion-content">
                  <span className="suggestion-title">{s.title}</span>
                  <span className="suggestion-prompt">{s.prompt.slice(0, 60)}...</span>
                </div>
                <SendIcon size={14} />
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
        p.type === "reasoning"
    );

  const lastMsg = messages?.[messages.length - 1];
  const lastHasContent = lastMsg ? hasVisibleContent(lastMsg) : false;
  const showTyping = status === "busy" && !lastHasContent;

  const visibleMessages = (messages || []).filter(
    (m) => !showTyping || m.role !== "assistant" || hasVisibleContent(m)
  );
  const isWindowed = visibleMessages.length > windowSize;
  const renderedMessages = isWindowed
    ? visibleMessages.slice(-windowSize)
    : visibleMessages;

  return (
    <div className={`chat ${status === "busy" ? "busy" : ""}`} ref={scrollRef} onScroll={onScroll}>
      {error && <div className="error-banner">{error}</div>}
      <div className="messages">
        {(!messages || messages.length === 0) && status !== "busy" && (
          <p className="muted">Начни диалог — напиши сообщение ниже</p>
        )}
        {isWindowed && (
          <div style={{ textAlign: "center", margin: "8px 0 16px" }}>
            <button
              className="btn-ghost sm"
              style={{ fontSize: 12.5, padding: "8px 16px", borderRadius: 20, background: "var(--bg-elev)", color: "var(--text)", border: "1px solid var(--border)", cursor: "pointer", fontWeight: 600, transition: "all 0.15s" }}
              onClick={() => setWindowSize((s) => s + 40)}
            >
              ↑ Показать предыдущие сообщения ({visibleMessages.length - windowSize})
            </button>
          </div>
        )}
        {renderedMessages.map((m, i, arr) => {
          const isWorking = status === "busy" && m.role === "assistant" && i === arr.length - 1;
          return <MessageItem key={m.id} message={m} isWorking={isWorking} />;
        })}
        {showTyping && (
          <div className="msg assistant">
            <span className="avatar assistant working">
              <span>✦</span>
            </span>
            <div className="msg-body">
              <span className="typing">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      {showScrollBtn && (
        <button className="scroll-to-bottom" onClick={scrollToBottom} title="К последнему сообщению">
          <ChevronDownIcon size={18} />
        </button>
      )}
    </div>
  );
}
