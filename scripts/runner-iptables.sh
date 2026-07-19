#!/usr/bin/env bash
# Релиз 5: автоматизация ручного шага из RUNNER_ISOLATION.md:
# разрешающие правила DOCKER-USER для связи прокси <-> раннеры
# при icc=false. Идемпотентен: проверяет наличие правила (-C) перед вставкой.
set -euo pipefail

PROXY_IP="${PROXY_IP:-172.28.0.10}"
RUNNER_SUBNET="${RUNNER_SUBNET:-172.28.0.0/24}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Запускай от root: sudo $0" >&2
  exit 1
fi

ensure() {
  if iptables -C DOCKER-USER "$@" 2>/dev/null; then
    echo "OK (уже есть): iptables -I DOCKER-USER $*"
  else
    iptables -I DOCKER-USER "$@"
    echo "ДОБАВЛЕНО: iptables -I DOCKER-USER $*"
  fi
}

ensure -s "$PROXY_IP" -d "$RUNNER_SUBNET" -j ACCEPT
ensure -s "$RUNNER_SUBNET" -d "$PROXY_IP" -j ACCEPT

# Сохранить правила между перезагрузками (Debian/Ubuntu).
if command -v netfilter-persistent >/dev/null 2>&1; then
  netfilter-persistent save
  echo "Правила сохранены (netfilter-persistent)."
else
  echo "СОВЕТ: apt-get install -y iptables-persistent && netfilter-persistent save"
fi
