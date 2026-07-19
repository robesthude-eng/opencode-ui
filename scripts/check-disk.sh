#!/usr/bin/env bash
# Релиз 5: мониторинг диска без авто-prune (очистка — только вручную).
# Для cron: */30 * * * * /path/to/scripts/check-disk.sh || отправь алерт.
# Выходной код 2 = порог превышен.
set -u

THRESHOLD="${DISK_ALERT_THRESHOLD:-85}"
DATA_DIR="${OPENCODE_DATA_DIR:-/srv/opencode-data}"
[ -d "$DATA_DIR" ] || DATA_DIR="/"

usage=$(df -P "$DATA_DIR" | awk 'NR==2 {gsub("%","",$5); print $5}')
echo "Диск под $DATA_DIR: ${usage}% занято (порог ${THRESHOLD}%)"

if command -v docker >/dev/null 2>&1; then
  docker system df 2>/dev/null || true
fi

if [ "$usage" -ge "$THRESHOLD" ]; then
  echo "ALERT: диск занят на ${usage}% (>= ${THRESHOLD}%). Очистка ВРУЧНУЮ:" >&2
  echo "  docker system df; docker image prune (после проверки!); старые sessions/" >&2
  exit 2
fi
