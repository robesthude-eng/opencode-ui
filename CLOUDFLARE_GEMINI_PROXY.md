# Cloudflare Gemini Proxy — Интеграция

## Статус
✅ Worker создан и доступен: `https://browserai-proxy.robesthud.workers.dev`

## Что нужно сделать

### 1. Добавь переменную окружения

В `.env` (или через docker-compose) добавь:

```env
GEMINI_PROXY_URL=https://browserai-proxy.robesthud.workers.dev
```

### 2. Настройка ключа Gemini

1. Зайди в Cloudflare Dashboard → Workers → `browserai-proxy`
2. Settings → Variables → Add variable:
   - **Name**: `GEMINI_API_KEY`
   - **Value**: твой ключ `AIza...`

### 3. Проверка

```bash
curl -X POST "https://browserai-proxy.robesthud.workers.dev/v1beta/models/gemini-2.5-flash:generateContent" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Hello from proxy"}]}]}'
```

Должен вернуть JSON с ответом Gemini.

## Как это работает

- Все запросы к Gemini теперь идут через Cloudflare
- Исходящий IP = Cloudflare (поддерживаемый регион)
- Ключ хранится только в Worker'е (безопасно)

## Следующие шаги

После добавления `GEMINI_PROXY_URL` в окружение:
- Перезапусти приложение
- Gemini должен начать работать без ошибки региона

## Готово!
```