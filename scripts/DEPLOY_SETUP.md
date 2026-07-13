# Настройка auto-deploy на VDS

Один раз, при первичной настройке нового сервера (или воссоздании после потери).

## 1. Скопировать deploy-скрипт на VDS

```bash
# С локальной машины
scp scripts/deploy-remote.sh root@<VDS>:/root/deploy.sh
ssh root@<VDS> chmod +x /root/deploy.sh
```

Или, если ты уже на VDS:
```bash
cp /app/opencode-ui/scripts/deploy-remote.sh /root/deploy.sh
chmod +x /root/deploy.sh
```

## 2. Сгенерировать SSH deploy-key

```bash
ssh-keygen -t ed25519 -f /root/.ssh/gh-deploy/id_ed25519 -N "" \
  -C "github-actions-deploy@opencode-ui"
```

## 3. Добавить public key в authorized_keys с restriction

Ограничение `command="/root/deploy.sh"` заставляет любой SSH-логин
с этим ключом запустить **только** deploy.sh — shell не даётся,
файлы не читаются, порты не форвардятся.

```bash
PUB=$(cat /root/.ssh/gh-deploy/id_ed25519.pub)
mkdir -p /root/.ssh && chmod 700 /root/.ssh
touch /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys
echo "command=\"/root/deploy.sh\",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty $PUB" >> /root/.ssh/authorized_keys
```

## 4. Добавить приватный ключ в GitHub Secrets

- Открыть `https://github.com/<owner>/<repo>/settings/secrets/actions`
- New repository secret:
  - `VDS_HOST` = IP или домен сервера
  - `VDS_DEPLOY_KEY` = содержимое `/root/.ssh/gh-deploy/id_ed25519` (полный файл)

## 5. Проверить работоспособность

С любой машины (без интерактивного логина):
```bash
ssh -i /path/to/deploy-key root@<VDS> "любая команда"
# должно вывести лог deploy.sh независимо от команды
```

## 6. Триггер вручную (без push)

- `https://github.com/<owner>/<repo>/actions/workflows/deploy.yml`
- Кнопка «Run workflow» → main

## Как работает

`deploy.sh` при запуске:

1. `git fetch origin main` — узнаёт последнюю ветку
2. Если код на VDS отстал → `git stash + reset --hard origin/main`
3. Если git-hash тот же, но docker-image старше git-HEAD → всё равно пересобирает
4. `docker compose up -d --build` — пересборка контейнера с новым кодом
5. Ждёт HTTP 200 на порту 3000 до 30 сек

## Безопасность

- Ключ **никогда** не даёт shell — только запуск `deploy.sh`
- `deploy.sh` работает **только** внутри `/app/opencode-ui`
- Никаких пробросов портов, X11, agent
- Если ключ засветится → просто удали строку из `authorized_keys`
