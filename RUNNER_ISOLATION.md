# Изоляция «новый чат = новый контейнер» (RUNNER_ISOLATION)

## Что это

Раньше все чаты работали в ОДНОМ контейнере с платформой: изоляция была
только на уровне папок (?directory=sessions/<sid>/workspace). Агент мог
`pkill -f node` и убить весь бэкенд (именно это случилось с игрой в шашки).

Теперь при RUNNER_ISOLATION=1:

- **Каждый новый чат = отдельный Docker-контейнер** (`oc-ses-<sid>`, образ
  `opencode-runner`) со своим экземпляром `opencode serve`.
- В контейнер монтируется **только каталог этой сессии**
  (`<data>/sessions/<sid>` -> `/session`). Чужие сессии, код платформы,
  docker.sock — физически недоступны.
- Память opencode (история, конфиг) живёт внутри каталога сессии —
  «новый чат = новая память» сохраняется, как и раньше.
- Лимиты: память/CPU/число процессов + no-new-privileges.
- Терминал в UI открывается ВНУТРИ контейнера сессии (docker exec).
- Простой 30 мин (RUNNER_IDLE_STOP_MIN) — контейнер останавливается
  (данные остаются), при следующем обращении автоматически запускается.
- Удаление чата = удаление контейнера и каталога сессии.
- Старые (legacy) чаты, созданные до включения флага, продолжают работать
  по старой схеме через системный инстанс (плавная миграция).
- Сессия самоулучшения пока остаётся в основном контейнере: её конвейер
  (biome/tsc/vitest/vite + подмена dist) работает в платформе и защищён
  собственной песочницей (sandbox.mjs: только src/**, лимиты, транзакции).

## Новые/изменённые файлы

| Файл | Что |
|---|---|
| `server/runner.mjs` | НОВЫЙ: жизненный цикл контейнеров (создание, автозапуск, реестр, реапер, удаление) |
| `Dockerfile.runner` | НОВЫЙ: образ раннера (node + opencode + git) |
| `runner-entry.sh` | НОВЫЙ: entrypoint раннера (конфиг/auth/запуск opencode) |
| `server/index.mjs` | Маршрутизация per-session запросов и WebSocket в контейнер сессии; GET /api/session/:sid/runner |
| `server/routes/session.mjs` | Создание/список/удаление сессий через раннеры |
| `server/terminal.mjs` | Терминал через docker exec в контейнер сессии |
| `Dockerfile` | + статический Docker CLI |
| `docker-compose.yml` | bind-mount данных, docker.sock, сеть `opencode-runners`, сервис сборки образа |

## Развёртывание на VPS

```bash
# 1. Остановить текущий стек
cd /path/to/opencode-ui && docker compose down

# 2. МИГРАЦИЯ ДАННЫХ: из named volume в bind-каталог хоста
sudo mkdir -p /srv/opencode-data
docker run --rm -v opencode-ui_opencode_data:/from -v /srv/opencode-data:/to \
  alpine sh -c "cp -a /from/. /to/"
# (имя volume проверь: docker volume ls | grep opencode)

# 3. В .env добавить (путь — абсолютный, на ХОСТЕ):
#   OPENCODE_DATA_DIR=/srv/opencode-data
#   RUNNER_ISOLATION=1

# 4. Собрать образ раннера и платформу
docker compose --profile build-runner build runner-image
docker compose build opencode-ui

# 5. Запуск
docker compose up -d
```

## Проверка

```bash
# Создай новый чат в UI, затем:
docker ps --format '{{.Names}}' | grep oc-ses-   # появился контейнер сессии
# В чате попроси агента: pkill -9 -f node — умрёт только его контейнер,
# платформа и другие чаты продолжат работать.
```

## Порты приложений (например, игра с WebSocket на 3001)

Каждый раннер публикует порты из RUNNER_PUBLISH_PORTS (по умолчанию 3001)
на СЛУЧАЙНЫЕ порты хоста, но ТОЛЬКО на 127.0.0.1 (см. RUNNER_PUBLISH_HOST) —
приложения пользователей не торчат в интернет напрямую. Узнать какой порт достался:
`GET /api/session/<sid>/runner` -> `{ "ports": { "3001": 32768 }, ... }`
Значит игра доступна на `ws://127.0.0.1:32768` с самого сервера. Наружу
отдавай через reverse-proxy (nginx/caddy) или SSH-туннель:
`ssh -L 32768:127.0.0.1:32768 user@server`.

## Изоляция сети раннеров (icc=false)

Межконтейнерная связь в сети `opencode-runners` выключена
(`com.docker.network.bridge.enable_icc: "false"` в docker-compose.yml):
агент из сессии не может сканировать сеть и ходить в чужие сессии (SSRF).

Чтобы при этом работал легитимный трафик прокси↔раннер, прокси имеет
статический IP `172.28.0.10` в подсети `172.28.0.0/24`, и на хосте нужно
ОДИН РАЗ добавить разрешающие правила (DOCKER-USER обходит запрет icc):

```bash
iptables -I DOCKER-USER -s 172.28.0.10 -d 172.28.0.0/24 -j ACCEPT
iptables -I DOCKER-USER -s 172.28.0.0/24 -d 172.28.0.10 -j ACCEPT
# сохранить правила между перезагрузками (Debian/Ubuntu):
apt-get install -y iptables-persistent && netfilter-persistent save
```

⚠️ Миграция: сеть `opencode-runners` уже существует со старыми опциями,
compose не пересоздаст её сам. Перед первым запуском с новым конфигом:
`docker compose down && docker rm -f $(docker ps -aq --filter name=oc-ses-) 2>/dev/null; docker network rm opencode-runners`.

## Переменные окружения

| Переменная | Дефолт | Смысл |
|---|---|---|
| RUNNER_ISOLATION | 1 (в compose) | 0 = старая схема, полный откат без правки кода |
| OPENCODE_DATA_DIR | /srv/opencode-data | абсолютный каталог данных на хосте |
| RUNNER_IMAGE | opencode-runner:latest | образ раннера |
| RUNNER_MEMORY / RUNNER_CPUS / RUNNER_PIDS_LIMIT | 512m / 0.5 / 512 | лимиты контейнера (свап отключён: memory-swap = memory) |
| RUNNER_USER | 1000:1000 | пользователь процессов раннера (не root) |
| RUNNER_IDLE_STOP_MIN | 30 | через сколько минут простоя останавливать контейнер |
| RUNNER_PUBLISH_PORTS | 3001 | какие порты приложений публиковать наружу |

## Как это работает внутри

1. POST /api/session: прокси создаёт временный каталог и одноразовый контейнер,
   создаёт в нём opencode-сессию (directory=/session/workspace), получает sid,
   переименовывает каталог в sessions/<sid> и поднимает постоянный контейнер
   oc-ses-<sid>. Создание чата теперь занимает ~5–10 секунд — это цена изоляции.
2. Все запросы чата (сообщения, /event, WebSocket) проксируются в
   http://oc-ses-<sid>:4096 по внутренней сети opencode-runners.
3. Глобальные маршруты (провайдеры, health, self-improve) и legacy-сессии —
   по-прежнему через системный инстанс в основном контейнере.
4. Скачивание/загрузка файлов и превью работают как раньше: прокси видит
   весь каталог данных, пути sessions/<sid>/workspace не изменились.

## Безопасность

- docker.sock смонтирован ТОЛЬКО в контейнер платформы (где агентский код
  больше НЕ выполняется). В раннеры он не пробрасывается.
- Имена контейнеров строятся только из валидированных sid (isValidSessionId),
  аргументы docker передаются массивом (без shell) — инъекции исключены.
- Проверки владельца сессии, auth, CSRF, rate-limit — без изменений.
