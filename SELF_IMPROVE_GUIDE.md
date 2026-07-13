# Руководство по безопасному самоулучшению (Self-Improvement Guide)

Привет, Агент! Ты в режиме самоулучшения. Задача — развивать, чинить и
оптимизировать веб-интерфейс (React 19 + Vite 7 + TypeScript + Tailwind 4).

## 🛡 Правила безопасности

**НЕЛЬЗЯ:**
* Писать напрямую в `src/**`, `public/**` через `write`/`edit` (даже если у тебя есть tool).
  Все изменения — **только** через sandbox → PR pipeline (см. ниже).
* Редактировать: `package.json`, `package-lock.json`, `server/**`,
  `vite.config.ts`, `tsconfig*`, `Dockerfile`, `.github/**`, `.env`, `docker-compose.yml`,
  `biome.json`, `vitest.config.ts`, `start.sh`. Whitelist: только `src/**`, `public/**`
  и документация верхнего уровня (`README.md`, `SELF_IMPROVE*.md`).

## ⚙️ Правильный workflow

### Быстрый вариант — одна команда через PR (РЕКОМЕНДУЕТСЯ)

```
POST /api/self-improve/create-pr
Cookie: opencode_session=<твоя сессия>
Origin: http://localhost:3000
Content-Type: application/json

{
  "title": "feat: краткое описание изменений",
  "body":  "детальное описание, что и зачем меняется",
  "files": [
    { "path": "src/components/Sidebar.tsx", "content": "<полное новое содержимое>" },
    { "path": "src/index.css", "content": "<...>" }
  ],
  "autoMerge": true
}
```

Что произойдёт **автоматически**:

1. **Сервер создаёт ветку** `si/<timestamp>` от актуального `origin/main`
2. **Пишет файлы** и коммитит с автором `self-improve@opencode-ui.local`
3. **Пушит** ветку на GitHub
4. **Открывает Pull Request** через GitHub API
5. **Если `autoMerge:true`** — включает auto-merge (когда CI зелёный, PR смержится сам)
6. **GitHub Actions CI** запускает: `biome check → tsc -b → vitest → vite build`
7. При зелёном CI **PR автоматически мержится** в main
8. **Deploy workflow** SSH на VDS, `git pull + docker compose up -d --build`
9. Через ~4-5 минут новая версия UI live

**Ответ endpoint:**
```json
{
  "status": "success",
  "number": 42,
  "url": "https://github.com/robesthude-eng/opencode-ui/pull/42",
  "branch": "si/2026-07-13-140255",
  "filesWritten": ["src/components/Sidebar.tsx"],
  "autoMerge": { "enabled": true, "requested": true }
}
```

### Медленный вариант — только dryRun через sandbox (без PR)

Если хочешь **сначала проверить**, что код валиден, до создания PR:

```
POST /api/sandbox/apply
{ "files": [...], "dryRun": true, "skipTests": true }
```

Sandbox запускает **Biome → tsc → vitest → vite build**. Если всё зелёное —
можешь смело делать `create-pr`. Если что-то упало — узнай причину из
`errors` в ответе и исправь.

## 🧯 Что делать, если сломалось

1. **UI недоступен** → скажи админу открыть Settings → Саморазвитие →
   «Мгновенный откат» (rollback dist snapshot за 1 секунду)
2. **Плохой PR смержился** → создай reverse-PR:
   `POST /create-pr` с содержимым файлов до правки, title "revert: ..."
3. **CI постоянно падает** — не создавай новый PR. Прочитай `errors`,
   найди корень проблемы, отвечай пользователю с объяснением.

## 📋 Стек (актуально)

React 19 · Vite 7 · Tailwind 4 · shadcn · TanStack Router · Zustand ·
better-sqlite3 · pino · Biome · Vitest · Node 22

## 🏗 Архитектура (что где)

- `src/components/` — React UI (Sidebar, ChatView, Composer, Settings, ...)
- `src/components/ui/` — shadcn/Radix primitives
- `src/store/useStore.ts` — Zustand (+ persist для prefs)
- `src/api/client.ts` — API client (HttpOnly cookie auth, `credentials: "include"`)
- `src/index.css` — Tailwind 4 tokens
- `src/router.tsx` — TanStack Router
- `server/` — auth, proxy, sandbox, backups (**не редактируется через sandbox**)
- `public/` — статические файлы (favicon, manifest, unregister-sw.html)
