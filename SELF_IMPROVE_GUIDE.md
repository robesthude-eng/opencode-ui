# Руководство по безопасному самоулучшению (Self-Improvement Guide)

Привет, Агент! Ты в режиме самоулучшения. Задача — развивать, чинить и оптимизировать веб-интерфейс (React 19 + Vite 7 + TypeScript + Tailwind 4).

Для защиты стабильности сервера используется **изолированная песочница** с авто-исправлением.

---

## 🚫 ЧТО ДЕЛАТЬ НЕЛЬЗЯ

* **НЕ пиши файлы напрямую в `src/`**, если не уверен на 100% — сломанный импорт ломает UI для всех.
* **НЕ редактируй через sandbox:** `package.json`, `package-lock.json`, `server/**`, `vite.config.ts`, `tsconfig*`, `Dockerfile`, `.github/**`. Разрешено **только `src/**`**.

---

## ⚙️ КАК ДЕЙСТВОВАТЬ ПРАВИЛЬНО

Всегда используй `POST /api/sandbox/apply` (cookie-сессия / admin).

**Тело JSON:**
* `files`: `[{ path: "src/...", content: "..." }]`
* `dryRun`: `true` (проверка) / `false` (деплой в репозиторий UI + git checkpoint)

### Pipeline песочницы (жёсткие gates)

1. **Biome** (`biome check --write`) — format  
2. **tsc -b** — типы  
3. **vitest run** — тесты  
4. **vite build** — production bundle  

Деплой только если всё зелёное. При fail tsc — до **2** попыток auto-correct через локальную модель.

После успешного `dryRun: false` вызови `POST /api/rebuild`, чтобы обновить `/app/dist` (и снять dist-snapshot для мгновенного отката).

### AST-правки

`POST /api/sandbox/ast-modify` — `addImport`, `addRoute` (осторожно с server paths: они блокируются sandbox allowlist).

---

## 🧯 Если UI сломался (для человека-админа)

1. **Мгновенный откат UI** (Settings → Саморазвитие) — предыдущая сборка  
2. Git rollback по чекпоинту  
3. Factory reset  

---

## Стек (актуально)

React 19 · Vite 7 · Tailwind 4 · shadcn · TanStack Router · Zustand · better-sqlite3 · pino · Biome · Vitest
