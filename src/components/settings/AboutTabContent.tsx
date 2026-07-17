const ABOUT_ROWS: Array<[string, string]> = [
  ["Версия:", "v18.1-audit-20260710"],
  [
    "Стек:",
    "React 19 · Vite 7 · Tailwind 4 · shadcn · TanStack Router · SQLite · Sentry",
  ],
  ["Auth:", "HttpOnly cookie + scrypt (+ optional pepper)"],
  ["Volume:", "/app/workspace · DB: opencode.db · backups/"],
  [
    "Админ-восстановление:",
    "Мгновенный откат сборки · Git rollback · factory reset",
  ],
  ["Sandbox:", "Biome → tsc → vitest → vite build"],
];

/** Static "О системе" (about) tab — no state, no props. */
export function AboutTabContent() {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-full bg-sky-600 flex items-center justify-center text-white">
          ℹ️
        </div>
        <div>
          <div className="font-semibold">OpenCode UI (Cloud Edition)</div>
          <div className="text-xs text-muted-foreground">
            Веб-интерфейс для AI-агента OpenCode — админка, чаты, workspace,
            self-improve.
          </div>
        </div>
      </div>
      {ABOUT_ROWS.map(([k, v]) => (
        <div
          key={k}
          className="flex justify-between items-center gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm"
        >
          <span className="text-muted-foreground shrink-0">{k}</span>
          <code className="text-xs text-right break-all">{v}</code>
        </div>
      ))}
      <p className="text-xs text-muted-foreground leading-relaxed">
        Совет администратору: перед рискованными правками агента включите
        саморазвитие → <strong>Создать чекпоинт</strong>. Если UI «поехал» —
        сначала <strong>Мгновенный откат</strong> (быстро), затем при
        необходимости Git-откат или заводской сброс.
      </p>
    </div>
  );
}
