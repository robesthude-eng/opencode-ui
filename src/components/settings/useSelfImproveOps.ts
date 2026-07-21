import { useCallback, useEffect, useRef, useState } from "react";
import { jsonOrNull } from "../../api/client";
import { useStore } from "../../store/useStore";

export type HealthInfo = {
  status?: string;
  opencode?: string;
  uptime?: number;
};

export type DbBackup = { name: string; bytes: number; time: string };
export type GitCheckpoint = { hash: string; subject: string; time: string };
export type DistSnapshot = {
  name: string;
  time: string;
  mtime: number;
  current?: boolean;
};

const getHeaders = () => ({ "Content-Type": "application/json" });

/**
 * Типовое тело JSON-ответа сервисных роутов. Разбор через jsonOrNull:
 * HTML-ответ (SPA-fallback / страница ошибки прокси) даёт {} вместо
 * «SyntaxError: Unexpected token '<'» из res.json().
 */
type ApiBody = {
  error?: string;
  detail?: string;
  status?: string;
  commit?: string;
  name?: string;
  version?: string;
  diff?: string;
  changed?: boolean;
};
const jsonBody = async (res: Response): Promise<ApiBody> =>
  (await jsonOrNull<ApiBody>(res)) ?? {};

/**
 * Encapsulates all data-loading and mutation logic for the "Саморазвитие"
 * (self-improve) settings tab: server health, DB backups, git checkpoints,
 * dist snapshots (instant rollback), audit logs, and the self-improve
 * enable/disable toggle.
 *
 * Called unconditionally from SettingsPanel (like the useState calls it
 * replaces) so this state survives switching between settings tabs. Initial
 * loading is gated on `open` transitioning from closed to open; polling is
 * gated on `isActiveTab` (only refresh while the self-improve tab is visible).
 */
export function useSelfImproveOps({
  open,
  isActiveTab,
}: {
  open: boolean;
  isActiveTab: boolean;
}) {
  const currentUser = useStore((s) => s.currentUser);
  const selfImproveEnabled = useStore((s) => s.selfImproveEnabled);
  const setSelfImproveEnabled = useStore((s) => s.setSelfImproveEnabled);
  const ensureSelfImproveSession = useStore((s) => s.ensureSelfImproveSession);
  const setWorkspaceOpen = useStore((s) => s.setWorkspaceOpen);
  const isAdminUser = currentUser?.role === "admin";

  const [rebuildStatus, setRebuildStatus] = useState<string | null>(null);
  const [resetStatus, setResetStatus] = useState<string | null>(null);
  const [checkpoints, setCheckpoints] = useState<GitCheckpoint[]>([]);
  const [auditLogs, setAuditLogs] = useState<string[]>([]);
  const [checkpointStatus, setCheckpointStatus] = useState<string | null>(null);
  const [rollbackStatus, setRollbackStatus] = useState<string | null>(null);
  const [distSnapshots, setDistSnapshots] = useState<DistSnapshot[]>([]);
  const [instantStatus, setInstantStatus] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [dbBackups, setDbBackups] = useState<DbBackup[]>([]);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [toggleBusy, setToggleBusy] = useState(false);
  const [sourceDiff, setSourceDiff] = useState<string | null>(null);
  const [diffStatus, setDiffStatus] = useState<string | null>(null);
  const [restoreStatus, setRestoreStatus] = useState<string | null>(null);

  const timersRef = useRef<number[]>([]);
  const tickRef = useRef(0);
  useEffect(() => {
    return () => {
      for (const t of timersRef.current) clearTimeout(t);
    };
  }, []);

  const schedule = useCallback((fn: () => void, delay: number) => {
    const t = window.setTimeout(() => {
      timersRef.current = timersRef.current.filter((id) => id !== t);
      fn();
    }, delay);
    timersRef.current.push(t);
    return t;
  }, []);

  const loadAuditLogs = async () => {
    try {
      const res = await fetch("/api/git/audit-logs", {
        credentials: "include",
        headers: getHeaders(),
      });
      if (res.ok) {
        const logs = await jsonOrNull(res);
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
        const cps = await jsonOrNull(res);
        setCheckpoints(Array.isArray(cps) ? cps : []);
      }
    } catch {
      setCheckpoints([]);
    }
  };

  const loadSourceDiff = async () => {
    setDiffStatus("Загрузка diff…");
    try {
      const res = await fetch("/api/git/diff", {
        credentials: "include",
        headers: getHeaders(),
      });
      const data = await jsonBody(res);
      if (!res.ok) throw new Error(data.error || "Не удалось загрузить diff");
      setSourceDiff(data.diff || "");
      setDiffStatus(
        data.changed ? "Изменения найдены" : "Нет непубликованных изменений",
      );
    } catch (error) {
      setDiffStatus(`Ошибка: ${(error as Error).message}`);
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
      const data = await jsonBody(res);
      if (res.ok) {
        setCheckpointStatus(
          data.status === "noop" ? "✔ Нет изменений" : `✔ ${data.commit}`,
        );
        await loadCheckpoints();
        schedule(() => setCheckpointStatus(null), 3500);
      } else {
        setCheckpointStatus(`Ошибка: ${data.error || "ошибка"}`);
        schedule(() => setCheckpointStatus(null), 4000);
      }
    } catch {
      setCheckpointStatus("Ошибка сети");
      schedule(() => setCheckpointStatus(null), 3000);
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
        const list = await jsonOrNull(res);
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
      const data = await jsonOrNull<HealthInfo>(res);
      if (!data) {
        setHealthError("Некорректный ответ сервера");
        setHealth(null);
        return;
      }
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
        const list = await jsonOrNull(res);
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
      const data = await jsonBody(res);
      if (res.ok) {
        setBackupStatus(`✔ ${data.name || "ok"}`);
        await loadDbBackups();
        schedule(() => setBackupStatus(null), 4000);
      } else {
        setBackupStatus(`Ошибка: ${data.error || data.detail || "failed"}`);
        schedule(() => setBackupStatus(null), 5000);
      }
    } catch {
      setBackupStatus("Ошибка сети");
      schedule(() => setBackupStatus(null), 3000);
    }
  };

  const handleRestoreBackup = async (name: string) => {
    if (
      !confirm(
        `Вы уверены, что хотите восстановить базу данных из бэкапа ${name}? Все текущие сессии и пользователи будут сброшены к состоянию этого снимка.`,
      )
    ) {
      return;
    }
    setRestoreStatus(name);
    try {
      const res = await fetch("/api/db/backup/restore", {
        credentials: "include",
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ name }),
      });
      const data = await jsonBody(res);
      if (res.ok) {
        setRestoreStatus("✔ База восстановлена! Перезагрузка…");
        schedule(() => window.location.reload(), 1500);
      } else {
        setRestoreStatus(`Ошибка: ${data.error || "failed"}`);
        schedule(() => setRestoreStatus(null), 5000);
      }
    } catch {
      setRestoreStatus("Ошибка сети");
      schedule(() => setRestoreStatus(null), 3000);
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
      const res = await fetch("/api/dist/rollback", {
        credentials: "include",
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ index }),
      });
      const data = await jsonBody(res);
      if (res.ok) {
        setInstantStatus(`✔ ${data.version || "готово"} — перезагрузка…`);
        await loadDistSnapshots();
        schedule(() => window.location.reload(), 800);
      } else {
        setInstantStatus(`Ошибка: ${data.error || data.detail || "failed"}`);
        schedule(() => setInstantStatus(null), 5000);
      }
    } catch {
      setInstantStatus("Ошибка сети");
      schedule(() => setInstantStatus(null), 3000);
    }
  };

  const handleRollback = async (hash: string) => {
    if (
      !confirm(
        `Откатить источники UI к коммиту [${hash}] и пересобрать (1–2 мин)? Несохранённые правки будут потеряны.`,
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
      const data = await jsonBody(res);
      if (res.ok) {
        setRollbackStatus("✔ Собрано! Перезагрузка…");
        schedule(() => window.location.reload(), 1500);
      } else {
        setRollbackStatus(`Ошибка: ${data.error || "failed"}`);
        schedule(() => setRollbackStatus(null), 4000);
      }
    } catch {
      setRollbackStatus("Ошибка сети");
      schedule(() => setRollbackStatus(null), 3000);
    }
  };

  const handleToggleSelfImprove = async () => {
    if (toggleBusy || !isAdminUser) return;
    const next = !selfImproveEnabled;
    setToggleBusy(true);
    // Optimistic UI — server toggle is fast now (no recursive chmod)
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
        const data = await jsonBody(res);
        setRebuildStatus(
          res.status === 403
            ? "Только администратор может менять этот режим"
            : `Ошибка: ${data.error || "не удалось изменить режим"}`,
        );
        schedule(() => setRebuildStatus(null), 4000);
      } else if (next) {
        // Self-Improvement turned ON → auto-create & open the «Самоулучшение» chat
        // so the user can immediately study the project, find bugs, add features.
        ensureSelfImproveSession().catch(() => {});
        setWorkspaceOpen(true);
      }
    } catch {
      setSelfImproveEnabled(!next);
      setRebuildStatus("Ошибка сети");
      schedule(() => setRebuildStatus(null), 3000);
    } finally {
      setToggleBusy(false);
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
      const data = await jsonBody(res);
      if (res.ok) {
        setRebuildStatus("success");
        await loadDistSnapshots();
        // New build is live — soft prompt to reload
        schedule(() => {
          if (confirm("UI пересобран. Обновить страницу сейчас?")) {
            window.location.reload();
          } else {
            setRebuildStatus(null);
          }
        }, 400);
      } else {
        setRebuildStatus(`error: ${data.error || "failed"}`);
        schedule(() => setRebuildStatus(null), 5000);
      }
    } catch {
      setRebuildStatus("error: network");
      schedule(() => setRebuildStatus(null), 4000);
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
      const data = await jsonBody(res);
      if (res.ok) {
        setResetStatus("success");
        schedule(() => window.location.reload(), 1500);
      } else {
        setResetStatus(`error: ${data.error || "failed"}`);
      }
    } catch {
      setResetStatus("error: network");
    }
    schedule(() => setResetStatus(null), 4000);
  };

  // UX-fix: загружаем данные только когда open переключается false→true, а НЕ на
  // каждый ре-рендер стора (см. историю SettingsPanel.tsx до разбиения: без
  // этого гарда useEffect срабатывал слишком часто).
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      loadCheckpoints().catch(() => {});
      loadAuditLogs().catch(() => {});
      loadDistSnapshots().catch(() => {});
      loadHealth().catch(() => {});
      loadDbBackups().catch(() => {});
    }
    prevOpenRef.current = open;
  }, [open]);

  // Keep health + logs fresh while admin is on self-improve tab (staggered, not 4 parallel)
  useEffect(() => {
    if (!open || !isActiveTab || !isAdminUser || toggleBusy) return;
    const id = setInterval(() => {
      tickRef.current += 1;
      const tick = tickRef.current;
      // Round-robin so we never hammer the server with 4 concurrent requests
      if (tick % 4 === 1) loadHealth().catch(() => {});
      else if (tick % 4 === 2) loadAuditLogs().catch(() => {});
      else if (tick % 4 === 3) loadDistSnapshots().catch(() => {});
      else loadDbBackups().catch(() => {});
    }, 10000);
    return () => clearInterval(id);
  }, [open, isActiveTab, isAdminUser, toggleBusy]);

  return {
    isAdminUser,
    currentUser,
    selfImproveEnabled,
    toggleBusy,
    handleToggleSelfImprove,
    health,
    healthError,
    loadHealth,
    dbBackups,
    backupStatus,
    restoreStatus,
    handleCreateBackup,
    handleRestoreBackup,
    distSnapshots,
    instantStatus,
    handleInstantRollback,
    checkpoints,
    checkpointStatus,
    rollbackStatus,
    rebuildStatus,
    resetStatus,
    sourceDiff,
    diffStatus,
    loadSourceDiff,
    handleCreateCheckpoint,
    handleRebuild,
    handleResetUI,
    handleRollback,
    auditLogs,
    loadAuditLogs,
  };
}
