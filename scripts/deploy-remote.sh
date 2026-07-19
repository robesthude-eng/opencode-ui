#!/bin/sh
# Ограниченный deploy-скрипт: pull + rebuild контейнера.
# GitHub Actions авторизован ТОЛЬКО на его выполнение (см. authorized_keys).
set -e

cd /app/opencode-ui

echo "═══ DEPLOY $(date -u +%Y-%m-%dT%H:%M:%SZ) ═══"

# --- 1. Pull ---
echo "[deploy] git fetch..."
git fetch origin main
LOCAL_HASH=$(git rev-parse HEAD)
REMOTE_HASH=$(git rev-parse origin/main)

CODE_CHANGED=0
if [ "$LOCAL_HASH" != "$REMOTE_HASH" ]; then
  echo "[deploy] pull $LOCAL_HASH → $REMOTE_HASH"
  git stash push -m "auto-stash before deploy" 2>/dev/null || true
  git reset --hard origin/main
  CODE_CHANGED=1
else
  echo "[deploy] уже на актуальной версии ($LOCAL_HASH)"
fi

# --- 2. Проверяем: не отстал ли образ от кода на диске ---
# Если git HEAD новее чем создание образа — пересобираем
IMAGE_CREATED=$(docker inspect opencode-ui-opencode-ui:latest --format '{{.Created}}' 2>/dev/null | head -1)
GIT_HEAD_TIME=$(git log -1 --format=%cI 2>/dev/null)
IMAGE_STALE=0
if [ -n "$IMAGE_CREATED" ] && [ -n "$GIT_HEAD_TIME" ]; then
  # timestamps to epoch
  IMG_EPOCH=$(date -d "$IMAGE_CREATED" +%s 2>/dev/null || echo 0)
  GIT_EPOCH=$(date -d "$GIT_HEAD_TIME" +%s 2>/dev/null || echo 0)
  if [ "$GIT_EPOCH" -gt "$IMG_EPOCH" ]; then
    echo "[deploy] образ отстал: image=$IMAGE_CREATED, git=$GIT_HEAD_TIME"
    IMAGE_STALE=1
  fi
fi

if [ "$CODE_CHANGED" = "0" ] && [ "$IMAGE_STALE" = "0" ]; then
  echo "[deploy] ничего пересобирать не надо"
  exit 0
fi

# --- 3. Rebuild ---
echo "[deploy] docker compose up -d --build (это займёт 1-2 минуты)..."
docker compose up -d --build 2>&1 | tail -20

# --- 4. Дождёмся HTTP 200 ---
echo "[deploy] wait for :3000 to respond..."
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 3
  CODE=$(curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/ 2>/dev/null || echo 000)
  if [ "$CODE" = "200" ]; then
    echo "[deploy] ✓ live at HTTP $CODE (after $((i*3))s)"
    echo "═══ DEPLOY OK ═══"
    exit 0
  fi
done

echo "[deploy] ❌ HTTP не 200 за 30 сек"
docker ps --filter name=opencode-ui
exit 1
