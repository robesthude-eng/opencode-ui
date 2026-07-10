import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { PROVIDERS, ZEN_FREE_MODELS, ZEN_PROVIDER_ID } from "../config/providers";
import { useStore } from "../store/useStore";
import { CheckIcon, CloseIcon } from "./icons";

type SettingsTab = "self-improve" | "free-models" | "providers" | "about";

export default function SettingsPanel() {
  const open = useStore((s) => s.settingsOpen);
  const setOpen = useStore((s) => s.setSettingsOpen);
  const authed = useStore((s) => s.authed);
  const loadAuth = useStore((s) => s.loadAuth);
  const saveKey = useStore((s) => s.saveKey);
  const removeKey = useStore((s) => s.removeKey);
  const selfImproveEnabled = useStore((s) => s.selfImproveEnabled);
  const setSelfImproveEnabled = useStore((s) => s.setSelfImproveEnabled);
  const currentUser = useStore((s) => s.currentUser);
  const isAdminUser = currentUser?.role === "admin";

  const [activeTab, setActiveTab] = useState<SettingsTab>("self-improve");
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [editingZen, setEditingZen] = useState(false);
  const [editingProviders, setEditingProviders] = useState<Record<string, boolean>>({});
  const [rebuildStatus, setRebuildStatus] = useState<string | null>(null);
  const [resetStatus, setResetStatus] = useState<string | null>(null);
  const [checkpoints, setCheckpoints] = useState<{ hash: string; subject: string; time: string }[]>(
    [],
  );
  const [auditLogs, setAuditLogs] = useState<string[]>([]);
  const [checkpointStatus, setCheckpointStatus] = useState<string | null>(null);
  const [rollbackStatus, setRollbackStatus] = useState<string | null>(null);
  const [distSnapshots, setDistSnapshots] = useState<
    { name: string; time: string; mtime: number }[]
  >([]);
  const [instantStatus, setInstantStatus] = useState<string | null>(null);
  const [health, setHealth] = useState<{
    status?: string;
    opencode?: string;
    uptime?: number;
  } | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [dbBackups, setDbBackups] = useState<{ name: string; bytes: number; time: string }[]>([]);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);

  const getHeaders = () => ({
    "Content-Type": "application/json",
  });

  const loadAuditLogs = async () => {
    try {
      const res = await fetch("/api/git/audit-logs", {
        credentials: "include",
        headers: getHeaders(),
      });
      if (res.ok) {
        const logs = await res.json();
        setAuditLogs(Array.isArray(logs) ? logs : []);
      }
    } catch {
      setAuditLogs([]);
    }
  };

  const loadCheckpoints = async () => {
    try {
      const res = await fetch("/api/git/checkpoints", {
        credentials: "include",
        headers: getHeaders(),
      });
      if (res.ok) {
        const cps = await res.json();
        setCheckpoints(Array.isArray(cps) ? cps : []);
      }
    } catch {
      setCheckpoints([]);
    }
  };

  const handleCreateCheckpoint = async () => {
    setCheckpointStatus("Создание...");
    try {
      const res = await fetch("/api/git/checkpoint", {
        credentials: "include",
        method: "POST",
        headers: getHeaders(),
      });
      const data = await res.json();
      if (res.ok) {
        setCheckpointStatus(data.status === "noop" ? "✔ Нет изменений" : `✔ ${data.commit}`);
        await loadCheckpoints();
        setTimeout(() => setCheckpointStatus(null), 3500);
      } else {
        setCheckpointStatus(`Ошибка: ${data.error || "ошибка"}`);
        setTimeout(() => setCheckpointStatus(null), 4000);
      }
    } catch {
      setCheckpointStatus("Ошибка сети");
      setTimeout(() => setCheckpointStatus(null), 3000);
    }
  };

  const loadDistSnapshots = async () => {
    if (!isAdminUser) return;
    try {
      const res = await fetch("/api/dist/snapshots", {
        credentials: "include",
        headers: getHeaders(),
      });
      if (res.ok) {
        const list = await res.json();
        setDistSnapshots(Array.isArray(list) ? list : []);
      }
    } catch {
      setDistSnapshots([]);
    }
  };

  const loadHealth = async () => {
    try {
      const res = await fetch("/health", { credentials: "include" });
      if (!res.ok) {
        setHealthError(`HTTP ${res.status}`);
        setHealth(null);
        return;
      }
      const data = await res.json();
      setHealth(data);
      setHealthError(null);
    } catch {
      setHealthError("Нет связи");
      setHealth(null);
    }
  };

  const loadDbBackups = async () => {
    if (!isAdminUser) return;
    try {
      const res = await fetch("/api/db/backups", {
        credentials: "include",
        headers: getHeaders(),
      });
      if (res.ok) {
        const list = await res.json();
        setDbBackups(Array.isArray(list) ? list : []);
      }
    } catch {
      setDbBackups([]);
    }
  };

  const handleCreateBackup = async () => {
    setBackupStatus("Создание…");
    try {
      const res = await fetch("/api/db/backup", {
        credentials: "include",
        method: "POST",
        headers: getHeaders(),
      });
      const data = await res.json();
      if (res.ok) {
        setBackupStatus(`✔ ${data.name || "ok"}`);
        await loadDbBackups();
        setTimeout(() => setBackupStatus(null), 4000);
      } else {
        setBackupStatus(`Ошибка: ${data.error || data.detail || "failed"}`);
        setTimeout(() => setBackupStatus(null), 5000);
      }
    } catch {
      setBackupStatus("Ошибка сети");
      setTimeout(() => setBackupStatus(null), 3000);
    }
  };

  const handleInstantRollback = async (index = 0) => {
    if (
      !confirm(
        "Мгновенно вернуть предыдущую собранную версию UI (без пересборки, ~мгновенно)? Текущая страница перезагрузится.",
      )
    )
      return;
    setInstantStatus("Откат…");
    try {
      const res = await fetch("/api/dist/instant-rollback", {
        credentials: "include",
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ index }),
      });
      const data = await res.json();
      if (res.ok) {
        setInstantStatus(`✔ ${data.version || "готово"} — перезагрузка…`);
        await loadDistSnapshots();
        setTimeout(() => window.location.reload(), 800);
      } else {
        setInstantStatus(`Ошибка: ${data.error || data.detail || "failed"}`);
        setTimeout(() => setInstantStatus(null), 5000);
      }
    } catch {
      setInstantStatus("Ошибка сети");
      setTimeout(() => setInstantStatus(null), 3000);
    }
  };

  const handleRollback = async (hash: string) => {
    if (
      !confirm(
        `Откатить исходники UI к коммиту [${hash}] и пересобрать (1–2 мин)? Несохранённые правки будут потеряны.`,
      )
    )
      return;
    setRollbackStatus(`Откат к [${hash}]…`);
    try {
      const res = await fetch("/api/git/rollback", {
        credentials: "include",
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ hash }),
      });
      const data = await res.json();
      if (res.ok) {
        setRollbackStatus("✔ Собрано! Перезагрузка…");
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setRollbackStatus(`Ошибка: ${data.error || "failed"}`);
        setTimeout(() => setRollbackStatus(null), 4000);
      }
    } catch {
      setRollbackStatus("Ошибка сети");
      setTimeout(() => setRollbackStatus(null), 3000);
    }
  };

  const handleToggleSelfImprove = async () => {
    const next = !selfImproveEnabled;
    setSelfImproveEnabled(next);
    try {
      const res = await fetch("/api/settings/self-improve", {
        credentials: "include",
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        setSelfImproveEnabled(!next);
        const data = await res.json().catch(() => ({}));
        setRebuildStatus(
          res.status === 403
            ? "Только администратор может менять этот режим"
            : `Ошибка: ${data.error || "не удалось изменить режим"}`,
        );
        setTimeout(() => setRebuildStatus(null), 4000);
      }
    } catch {
      setSelfImproveEnabled(!next);
      setRebuildStatus("Ошибка сети");
      setTimeout(() => setRebuildStatus(null), 3000);
    }
  };

  const handleRebuild = async () => {
    setRebuildStatus("building...");
    try {
      const res = await fetch("/api/rebuild", {
        credentials: "include",
        method: "POST",
        headers: getHeaders(),
      });
      const data = await res.json();
      if (res.ok) {
        setRebuildStatus("success");
        await loadDistSnapshots();
        // New build is live — soft prompt to reload
        setTimeout(() => {
          if (confirm("UI пересобран. Обновить страницу сейчас?")) {
            window.location.reload();
          } else {
            setRebuildStatus(null);
          }
        }, 400);
      } else {
        setRebuildStatus(`error: ${data.error || "failed"}`);
        setTimeout(() => setRebuildStatus(null), 5000);
      }
    } catch {
      setRebuildStatus("error: network");
      setTimeout(() => setRebuildStatus(null), 4000);
    }
  };

  const handleResetUI = async () => {
    if (
      !confirm(
        "Вы уверены? Весь код интерфейса в /app/workspace/opencode-ui будет сброшен к исходной версии из Git и пересобран.",
      )
    )
      return;
    setResetStatus("resetting...");
    try {
      const res = await fetch("/api/reset-ui", {
        credentials: "include",
        method: "POST",
        headers: getHeaders(),
      });
      const data = await res.json();
      if (res.ok) {
        setResetStatus("success");
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setResetStatus(`error: ${data.error || "failed"}`);
      }
    } catch {
      setResetStatus("error: network");
    }
    setTimeout(() => setResetStatus(null), 4000);
  };

  useEffect(() => {
    if (open) {
      loadAuth();
      loadCheckpoints();
      loadAuditLogs();
      loadDistSnapshots();
      loadHealth();
      loadDbBackups();
    }
  }, [open, loadAuth, isAdminUser]);

  // Keep health + logs fresh while admin is on self-improve tab
  useEffect(() => {
    if (!open || activeTab !== "self-improve" || !isAdminUser) return;
    const id = setInterval(() => {
      loadHealth();
      loadAuditLogs();
      loadDistSnapshots();
      loadDbBackups();
    }, 8000);
    return () => clearInterval(id);
  }, [open, activeTab, isAdminUser]);

  if (!open) return null;

  const handleSave = async (id: string) => {
    const key = (values[id] ?? "").trim();
    if (!key) return false;
    setSaving(id);
    const ok = await saveKey(id, key);
    setSaving(null);
    if (ok) {
      setValues((v) => ({ ...v, [id]: "" }));
    }
    return ok;
  };

  const zenConfigured = !!authed[ZEN_PROVIDER_ID];

  const tabs = [
    { id: "self-improve" as const, label: "Саморазвитие", icon: "🤖" },
    { id: "free-models" as const, label: "OpenCode Zen", icon: "🎁" },
    { id: "providers" as const, label: "API Провайдеры", icon: "🔑" },
    { id: "about" as const, label: "О системе", icon: "ℹ️" },
  ];

  const tabTitle = {
    "self-improve": "Режим саморазвития (Self-Improvement)",
    "free-models": "Бесплатные модели (OpenCode Zen)",
    providers: "Подключение сторонних API провайдеров",
    about: "О системе и архитектуре",
  }[activeTab];

  return (
    <div
      className="overlay fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sidebar */}
        <aside className="w-60 border-r border-border bg-muted/20 p-4 flex flex-col gap-4 shrink-0">
          <h2 className="text-lg font-semibold px-2">Настройки</h2>
          <nav className="flex flex-col gap-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                className={cn(
                  "flex items-center gap-2 w-full text-left px-3 py-2.5 rounded-xl text-sm transition",
                  activeTab === t.id
                    ? "bg-muted text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                )}
                onClick={() => setActiveTab(t.id)}
                type="button"
              >
                <span>{t.icon}</span> {t.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0">
          <header className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <h3 className="font-semibold">{tabTitle}</h3>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setOpen(false)}
              title="Close"
              type="button"
            >
              <CloseIcon />
            </Button>
          </header>

          <div className="flex-1 overflow-y-auto p-5">
            {/* SELF-IMPROVE TAB */}
            {activeTab === "self-improve" && (
              <div className="space-y-4">
                {/* Live system status — always useful for admin */}
                <div className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <h4 className="font-semibold text-sm flex items-center gap-2">
                      🩺 Состояние сервера
                    </h4>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[11px]"
                      onClick={loadHealth}
                      type="button"
                    >
                      Обновить
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                      <div className="text-muted-foreground mb-0.5">UI / proxy</div>
                      <div className="font-medium flex items-center gap-1.5">
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            health?.status === "ok" ? "bg-emerald-400" : "bg-red-400",
                          )}
                        />
                        {healthError
                          ? healthError
                          : health?.status === "ok"
                            ? "Работает"
                            : health?.status || "…"}
                      </div>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                      <div className="text-muted-foreground mb-0.5">OpenCode</div>
                      <div className="font-medium flex items-center gap-1.5">
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            health?.opencode === "healthy" ? "bg-emerald-400" : "bg-amber-400",
                          )}
                        />
                        {health?.opencode || "—"}
                      </div>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                      <div className="text-muted-foreground mb-0.5">Uptime</div>
                      <div className="font-medium font-mono">
                        {typeof health?.uptime === "number"
                          ? `${Math.floor(health.uptime / 60)}м ${Math.floor(health.uptime % 60)}с`
                          : "—"}
                      </div>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-2">
                    Вы: <code className="text-foreground">{currentUser?.email}</code> · роль:{" "}
                    <span className="font-medium text-foreground">
                      {currentUser?.role || "user"}
                    </span>
                    {selfImproveEnabled ? " · саморазвитие ●" : " · саморазвитие ○"}
                  </p>
                </div>

                {isAdminUser && (
                  <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="font-semibold text-sm flex items-center gap-2">
                          💾 Бэкап базы (SQLite)
                        </h4>
                        <p className="text-xs text-muted-foreground mt-1">
                          Снимок users/sessions на volume. Автоматически раз в сутки + вручную.
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        disabled={!!backupStatus}
                        onClick={handleCreateBackup}
                      >
                        {backupStatus || "Создать бэкап"}
                      </Button>
                    </div>
                    <div className="max-h-28 overflow-y-auto space-y-1">
                      {dbBackups.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground">
                          Бэкапов пока нет. Нажмите «Создать бэкап» или дождитесь ночного снимка.
                        </p>
                      ) : (
                        dbBackups.slice(0, 8).map((b) => (
                          <div
                            key={b.name}
                            className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-[11px]"
                          >
                            <span className="font-mono truncate min-w-0" title={b.name}>
                              {b.name}
                            </span>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-muted-foreground">
                                {(b.bytes / 1024).toFixed(1)} KB
                              </span>
                              <a
                                className="text-primary hover:underline"
                                href={`/api/db/backups/${encodeURIComponent(b.name)}`}
                                download={b.name}
                              >
                                Скачать
                              </a>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {!isAdminUser && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-200">
                    🔒 Саморазвитие меняет исходный код интерфейса для всех пользователей этого
                    сервера, поэтому доступно только администратору. Ваш аккаунт:{" "}
                    {currentUser?.role || "user"}.
                  </div>
                )}

                <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "h-9 w-9 rounded-full flex items-center justify-center text-white",
                        selfImproveEnabled ? "bg-emerald-600" : "bg-muted-foreground",
                      )}
                    >
                      🤖
                    </div>
                    <div>
                      <div className="font-semibold text-sm">
                        Саморазвитие агента (Self-Improvement)
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {selfImproveEnabled
                          ? "Включено: агент имеет права на модификацию исходного кода интерфейса и пересборку."
                          : "Выключено: агент работает в безопасном режиме без прав записи в файлы UI (read-only)."}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={!!selfImproveEnabled}
                      onCheckedChange={handleToggleSelfImprove}
                      disabled={!isAdminUser}
                    />
                    <button
                      type="button"
                      className="text-sm w-24 text-right hover:opacity-80 disabled:opacity-50"
                      onClick={isAdminUser ? handleToggleSelfImprove : undefined}
                      disabled={!isAdminUser}
                    >
                      {selfImproveEnabled ? "● Включено" : "○ Выключено"}
                    </button>
                  </div>
                </div>

                {/* Instant rollback — primary recovery path for admin */}
                {isAdminUser && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="font-semibold text-sm flex items-center gap-2">
                          ⚡ Мгновенный откат UI
                        </h4>
                        <p className="text-xs text-muted-foreground mt-1">
                          Возвращает последнюю удачную сборку без npm/vite (обычно &lt;1 с).
                          Используйте, если после саморазвития UI сломался.
                        </p>
                      </div>
                      <Button
                        size="sm"
                        className="shrink-0 bg-emerald-600 hover:bg-emerald-500 text-white"
                        disabled={
                          !!instantStatus || !selfImproveEnabled || distSnapshots.length < 2
                        }
                        onClick={() => handleInstantRollback(0)}
                        title={
                          distSnapshots.length < 2
                            ? "Нужно минимум 2 сборки (сделайте «Пересобрать UI»)"
                            : "Откатить на предыдущую сборку"
                        }
                      >
                        {instantStatus || "↩ Предыдущая сборка"}
                      </Button>
                    </div>
                    <div className="max-h-28 overflow-y-auto space-y-1">
                      {distSnapshots.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground">
                          Снимков пока нет. После «Пересобрать UI» здесь появятся версии.
                        </p>
                      ) : (
                        distSnapshots.map((s, i) => (
                          <div
                            key={s.name}
                            className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/60 px-2.5 py-1.5 text-[11px]"
                          >
                            <div className="min-w-0">
                              <span className="font-mono text-primary mr-2">
                                {i === 0 ? "текущая" : `−${i}`}
                              </span>
                              <span className="text-muted-foreground truncate">{s.name}</span>
                              <span className="text-muted-foreground ml-2">
                                {s.time ? new Date(s.time).toLocaleString() : ""}
                              </span>
                            </div>
                            {i > 0 && selfImproveEnabled && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 text-[10px] shrink-0"
                                disabled={!!instantStatus}
                                onClick={() => handleInstantRollback(i - 1)}
                              >
                                Восстановить
                              </Button>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                <div className="rounded-xl border border-border bg-card p-4 space-y-4">
                  <div>
                    <h4 className="font-semibold text-sm flex items-center gap-2">
                      📸 Чекпоинты Git и тяжёлые операции
                    </h4>
                    <p className="text-xs text-muted-foreground mt-1">
                      Снимки исходников и пересборка (дольше, чем мгновенный откат). Перед
                      экспериментами агента — создайте чекпоинт.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={!!checkpointStatus || !selfImproveEnabled || !isAdminUser}
                      onClick={handleCreateCheckpoint}
                    >
                      {checkpointStatus ? checkpointStatus : <>📸 Создать чекпоинт</>}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!!rebuildStatus || !isAdminUser}
                      onClick={handleRebuild}
                    >
                      ⚡{" "}
                      {rebuildStatus === "building..."
                        ? "Билд…"
                        : rebuildStatus === "success"
                          ? "✓ Готово"
                          : "Пересобрать UI"}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={!!resetStatus || !isAdminUser}
                      onClick={handleResetUI}
                    >
                      🔄{" "}
                      {resetStatus === "resetting..."
                        ? "Сброс…"
                        : resetStatus === "success"
                          ? "✓ Сброшено"
                          : "Заводской сброс"}
                    </Button>
                  </div>

                  {(rollbackStatus ||
                    (rebuildStatus &&
                      rebuildStatus !== "building..." &&
                      rebuildStatus !== "success")) && (
                    <div className="text-xs px-3 py-2 rounded-lg border border-blue-500/30 bg-blue-500/10 text-blue-300">
                      {rollbackStatus || rebuildStatus}
                    </div>
                  )}

                  <div className="border-t border-border pt-3">
                    <div className="text-xs font-semibold text-muted-foreground mb-2">
                      История чекпоинтов:
                    </div>
                    <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
                      {checkpoints.length === 0 ? (
                        <div className="text-xs text-muted-foreground py-1">
                          Нет сохранённых коммитов
                        </div>
                      ) : (
                        checkpoints.map((cp) => (
                          <div
                            key={cp.hash}
                            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="text-xs truncate">
                                <span className="text-primary font-mono mr-2">[{cp.hash}]</span>
                                {cp.subject}
                              </div>
                              <div className="text-[11px] text-muted-foreground">{cp.time}</div>
                            </div>
                            {selfImproveEnabled && isAdminUser && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-[11px] text-red-400 border-red-500/30 hover:bg-red-500/10 hover:text-red-300 shrink-0"
                                onClick={() => handleRollback(cp.hash)}
                                title={`Откатить UI к коммиту ${cp.hash}`}
                              >
                                🔄 Откатить
                              </Button>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="border-t border-border pt-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs font-semibold text-muted-foreground">
                        🖥️ Консоль событий (Логи самоулучшения):
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[11px]"
                        onClick={loadAuditLogs}
                        type="button"
                      >
                        Обновить 🔄
                      </Button>
                    </div>
                    <div className="max-h-44 overflow-y-auto rounded-lg bg-zinc-950 text-zinc-300 font-mono text-[11px] leading-relaxed p-3 border border-border">
                      {auditLogs.length === 0 ? (
                        <div className="text-zinc-500 italic">
                          Лог событий пуст. Выполните действие, чтобы наполнить консоль.
                        </div>
                      ) : (
                        auditLogs.map((log, index) => {
                          let color = "text-zinc-300";
                          if (log.includes("SUCCESS")) color = "text-emerald-400";
                          else if (log.includes("FAILED") || log.includes("WARNING"))
                            color = "text-red-400";
                          else if (log.includes("START")) color = "text-sky-400";
                          return (
                            <div key={index} className={cn("whitespace-pre-wrap break-all", color)}>
                              {log}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* FREE MODELS TAB */}
            {activeTab === "free-models" && (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-full bg-amber-500 flex items-center justify-center">
                      🎁
                    </div>
                    <div>
                      <div className="font-semibold">Free Models</div>
                      <div className="text-xs text-muted-foreground">
                        {ZEN_FREE_MODELS.length} free AI models via OpenCode Zen — one key unlocks
                        all.
                      </div>
                    </div>
                  </div>
                  <a
                    className="text-sm text-primary hover:underline"
                    href="https://opencode.ai/auth"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Get a free key →
                  </a>
                </div>

                {zenConfigured && !editingZen ? (
                  <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm">
                    <span className="flex items-center gap-2 text-emerald-300">
                      <CheckIcon size={16} /> OpenCode Zen connected — all free models available
                    </span>
                    <div className="flex gap-3 text-xs">
                      <button
                        className="text-primary hover:underline"
                        onClick={() => {
                          setEditingZen(true);
                          setValues((v) => ({ ...v, [ZEN_PROVIDER_ID]: "" }));
                        }}
                        type="button"
                      >
                        Change key
                      </button>
                      <button
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => removeKey(ZEN_PROVIDER_ID)}
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2 flex-wrap items-center">
                    <Input
                      type="password"
                      placeholder="Paste your OpenCode Zen API key"
                      value={values[ZEN_PROVIDER_ID] ?? ""}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [ZEN_PROVIDER_ID]: e.target.value }))
                      }
                      onKeyDown={(e) =>
                        e.key === "Enter" &&
                        handleSave(ZEN_PROVIDER_ID).then((ok) => {
                          if (ok) setEditingZen(false);
                        })
                      }
                      className="max-w-sm"
                      autoFocus={editingZen}
                    />
                    <Button
                      disabled={!values[ZEN_PROVIDER_ID]?.trim() || saving === ZEN_PROVIDER_ID}
                      onClick={() => {
                        handleSave(ZEN_PROVIDER_ID).then((ok) => {
                          if (ok) setEditingZen(false);
                        });
                      }}
                    >
                      {saving === ZEN_PROVIDER_ID
                        ? "Connecting…"
                        : editingZen
                          ? "Save key"
                          : "Connect free models"}
                    </Button>
                    {editingZen && (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setEditingZen(false);
                          setValues((v) => ({ ...v, [ZEN_PROVIDER_ID]: "" }));
                        }}
                        type="button"
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                )}

                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {ZEN_FREE_MODELS.map((m) => (
                    <div key={m.id} className="rounded-xl border border-border bg-card p-3">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {m.badge}
                        </span>
                        <span className="truncate">{m.name}</span>
                        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-semibold">
                          FREE
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{m.best}</p>
                      <div className="text-[11px] text-muted-foreground mt-2 flex gap-3">
                        <span>⏷ {m.context} ctx</span>
                        {m.sweBench && <span>◆ {m.sweBench} SWE</span>}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2">
                  <span>⚠️</span>
                  <span>
                    Free models may use your data for training during the free period. Avoid using
                    them for sensitive or commercial code.
                  </span>
                </div>
              </div>
            )}

            {/* PROVIDERS TAB */}
            {activeTab === "providers" && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold">Bring your own API key</h3>
                  <p className="text-xs text-muted-foreground">
                    Paid providers with zero data retention.
                  </p>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  {PROVIDERS.map((p) => {
                    const configured = !!authed[p.id];
                    return (
                      <div
                        key={p.id}
                        className={cn(
                          "rounded-xl border p-3 bg-card",
                          configured && "border-emerald-500/30",
                        )}
                      >
                        <div className="flex items-center gap-3 mb-2">
                          <div
                            className="h-8 w-8 rounded-lg flex items-center justify-center text-white text-sm font-bold"
                            style={{ background: p.color }}
                          >
                            {p.name.charAt(0)}
                          </div>
                          <div>
                            <div className="text-sm font-medium flex items-center gap-1.5">
                              {p.name} {configured && <CheckIcon size={14} />}
                            </div>
                            <div className="text-[11px] text-muted-foreground">{p.models}</div>
                          </div>
                        </div>
                        {configured && !editingProviders[p.id] ? (
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-emerald-400 flex items-center gap-1">
                              🔑 API key connected
                            </span>
                            <div className="flex gap-3">
                              <button
                                className="text-primary hover:underline"
                                onClick={() => {
                                  setEditingProviders((prev) => ({ ...prev, [p.id]: true }));
                                  setValues((v) => ({ ...v, [p.id]: "" }));
                                }}
                                type="button"
                              >
                                Change
                              </button>
                              <button
                                className="text-muted-foreground hover:text-foreground"
                                onClick={() => removeKey(p.id)}
                                type="button"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex gap-2 items-center flex-wrap">
                            <Input
                              type="password"
                              placeholder={p.keyHint}
                              value={values[p.id] ?? ""}
                              onChange={(e) => setValues((v) => ({ ...v, [p.id]: e.target.value }))}
                              onKeyDown={(e) =>
                                e.key === "Enter" &&
                                handleSave(p.id).then((ok) => {
                                  if (ok)
                                    setEditingProviders((prev) => ({ ...prev, [p.id]: false }));
                                })
                              }
                              className="flex-1 min-w-[180px] h-8"
                              autoFocus={editingProviders[p.id]}
                            />
                            <Button
                              size="sm"
                              disabled={!values[p.id]?.trim() || saving === p.id}
                              onClick={() => {
                                handleSave(p.id).then((ok) => {
                                  if (ok)
                                    setEditingProviders((prev) => ({ ...prev, [p.id]: false }));
                                });
                              }}
                            >
                              {saving === p.id ? "…" : editingProviders[p.id] ? "Save" : "Connect"}
                            </Button>
                            {editingProviders[p.id] && (
                              <button
                                className="text-xs text-muted-foreground hover:text-foreground"
                                onClick={() => {
                                  setEditingProviders((prev) => ({ ...prev, [p.id]: false }));
                                  setValues((v) => ({ ...v, [p.id]: "" }));
                                }}
                                type="button"
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                        )}
                        <a
                          className="text-xs text-primary hover:underline mt-2 inline-block"
                          href={p.docsUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Get a key →
                        </a>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ABOUT TAB */}
            {activeTab === "about" && (
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-sky-600 flex items-center justify-center text-white">
                    ℹ️
                  </div>
                  <div>
                    <div className="font-semibold">OpenCode UI (Cloud Edition)</div>
                    <div className="text-xs text-muted-foreground">
                      Веб-интерфейс для AI-агента OpenCode — админка, чаты, workspace, self-improve.
                    </div>
                  </div>
                </div>
                {[
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
                ].map(([k, v]) => (
                  <div
                    key={k}
                    className="flex justify-between items-center gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm"
                  >
                    <span className="text-muted-foreground shrink-0">{k}</span>
                    <code className="text-xs text-right break-all">{v}</code>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Совет администратору: перед рискованными правками агента включите саморазвитие →{" "}
                  <strong>Создать чекпоинт</strong>. Если UI «поехал» — сначала{" "}
                  <strong>Мгновенный откат</strong> (быстро), затем при необходимости Git-откат или
                  заводской сброс.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
