import React, { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import io from "socket.io-client";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
  workdir: string;
}

export function Terminal({ workdir }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const socketRef = useRef<any>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    // Инициализация Xterm
    const term = new XTerm({
      theme: {
        background: "#202020",
        foreground: "#e7e7e7",
        cursor: "#e7e7e7",
      },
      fontFamily: "monospace",
      fontSize: 13,
      cursorBlink: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(terminalRef.current);
    xtermRef.current = term;

    // WebGL-рендерер: заметно быстрее при болтливом выводе агента.
    // Грузится строго после open(); при недоступности WebGL или потере
    // контекста молча откатываемся на DOM-рендерер xterm.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // WebGL недоступен — остаёмся на дефолтном рендерере
    }

    // Инициализация Socket.IO
    const socket = io({
      path: "/socket.io",
      query: { workdir },
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      term.writeln("\x1b[32m*** Подключено к терминалу ***\x1b[0m");
      // Первичный размер для pty на сервере (создаётся 80x24, тут же подгоняем).
      socket.emit("resize", { cols: term.cols, rows: term.rows });
    });

    socket.on("data", (data: string) => {
      term.write(data);
    });

    socket.on("disconnect", () => {
      term.writeln("\r\n\x1b[31m*** Отключено от терминала ***\x1b[0m");
    });

    term.onData((data) => {
      socket.emit("data", data);
    });

    // FitAddon меняет cols/rows у xterm → пробрасываем в pty на сервере,
    // иначе для программ окно навсегда 80x24. До connect socket.io сам
    // буферизует emit'ы.
    term.onResize(({ cols, rows }) => {
      socket.emit("resize", { cols, rows });
    });

    let isDisposed = false;
    const safeFit = () => {
      if (isDisposed) return;
      try {
        if (term.element && term.element.clientWidth > 0 && term.element.clientHeight > 0) {
          if ((term as any)._core && (term as any)._core._renderService) {
            fitAddon.fit();
          }
        }
      } catch (e) {
        console.warn("fitAddon.fit error:", e);
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      safeFit();
    });
    resizeObserver.observe(terminalRef.current);

    // Initial fit with slight delay to ensure layout
    const timeoutId = setTimeout(safeFit, 50);

    return () => {
      isDisposed = true;
      clearTimeout(timeoutId);
      resizeObserver.disconnect();
      socket.disconnect();
      term.dispose();
    };
  }, [workdir]);

  return <div ref={terminalRef} className="h-full w-full overflow-hidden" />;
}
