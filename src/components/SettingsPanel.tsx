import { useEffect, useState } from "react";
import { useStore } from "../store/useStore";
import { PROVIDERS, ZEN_FREE_MODELS, ZEN_PROVIDER_ID } from "../config/providers";
import { CloseIcon, CheckIcon } from "./icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

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
  const [checkpoints, setCheckpoints] = useState<{ hash: string; subject: string; time: string }[]>([]);
  const [auditLogs, setAuditLogs] = useState<string[]>([]);
  const [checkpointStatus, setCheckpointStatus] = useState<string | null>(null);
  const [rollbackStatus, setRollbackStatus] = useState<string | null>(null);

  const getHeaders = () => ({
    "Content-Type": "application/json",
    "X-Auth-Token": typeof window !== "undefined" ? localStorage.getItem("opencode_auth_token") || "" : "",
  });

  const loadAuditLogs = async () => {
    try {
      const res = await fetch("/api/git/audit-logs", { headers: getHeaders() });
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
      const res = await fetch("/api/git/checkpoints", { headers: getHeaders() });
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
      const res = await fetch("/api/git/checkpoint", { method: "POST", headers: getHeaders() });
      const data = await res.json();
      if (res.ok) {
        setCheckpointStatus(data.status === "noop" ? "✔ Нет изменений" : `✔ ${data.commit}`);
        await loadCheckpoints();
        setTimeout(() => setCheckpointStatus(null), 3500);
      } else {
        setCheckpointStatus("Ошибка: " + (data.error || "ошибка"));
        setTimeout(() => setCheckpointStatus(null), 4000);
      }
    } catch {
      setCheckpointStatus("Ошибка сети");
      setTimeout(() => setCheckpointStatus(null), 3000);
    }
  };

  const handleRollback = async (hash: string) => {
    if (!confirm(`Точно откатить код интерфейса и пересобрать проект на коммит [${hash}]? Все несохранённые правки будут потеряны.`)) return;
    setRollbackStatus(`Откат к [${hash}]...`);
    try {
      const res = await fetch("/api/git/rollback", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ hash }),
      });
      const data = await res.json();
      if (res.ok) {
        setRollbackStatus("✔ Готово! Перезагрузка...");
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setRollbackStatus("Ошибка: " + (data.error || "failed"));
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
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        setSelfImproveEnabled(!next);
        const data = await res.json().catch(() => ({}));
        setRebuildStatus(res.status === 403 ? "Только администратор может менять этот режим" : "Ошибка: " + (data.error || "не удалось изменить режим"));
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
      const res = await fetch("/api/rebuild", { method: "POST", headers: getHeaders() });
      const data = await res.json();
      if (res.ok) {
        setRebuildStatus("success");
      } else {
        setRebuildStatus("error: " + (data.error || "failed"));
      }
    } catch {
      setRebuildStatus("error: network");
    }
    setTimeout(() => setRebuildStatus(null), 4000);
  };

  const handleResetUI = async () => {
    if (!confirm("Вы уверены? Весь код интерфейса в /app/workspace/opencode-ui будет сброшен к исходной версии из Git и пересобран.")) return;
    setResetStatus("resetting...");
    try {
      const res = await fetch("/api/reset-ui", { method: "POST", headers: getHeaders() });
      const data = await res.json();
      if (res.ok) {
        setResetStatus("success");
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setResetStatus("error: " + (data.error || "failed"));
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
    }
  }, [open, loadAuth]);

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
    "providers": "Подключение сторонних API провайдеров",
    "about": "О системе и архитектуре",
  }[activeTab];

  return (
    <div className="overlay fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setOpen(false)}>
      <div
        className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sidebar */}
        <aside className="w-60 border-r border-border bg-muted/20 p-4 flex flex-col gap-4 shrink-0">
          <h2 className="text-lg font-semibold px-2">Настройки</h2>
          <nav className="flex flex-col gap-1">
            {tabs.map(t => (
              <button
                key={t.id}
                className={cn(
                  "flex items-center gap-2 w-full text-left px-3 py-2.5 rounded-xl text-sm transition",
                  activeTab === t.id
                    ? "bg-muted text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
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
            <Button variant="ghost" size="icon" onClick={() => setOpen(false)} title="Close" type="button">
              <CloseIcon />
            </Button>
          </header>

          <div className="flex-1 overflow-y-auto p-5">
            {/* SELF-IMPROVE TAB */}
            {activeTab === "self-improve" && (
              <div className="space-y-4">
                {!isAdminUser && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-200">
                    🔒 Саморазвитие меняет исходный код интерфейса для всех пользователей этого сервера, поэтому доступно только администратору.
                    Ваш аккаунт: {currentUser?.role || "user"}.
                  </div>
                )}

                <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center gap-3">
                    <div className={cn("h-9 w-9 rounded-full flex items-center justify-center text-white", selfImproveEnabled ? "bg-emerald-600" : "bg-muted-foreground")}>🤖</div>
                    <div>
                      <div className="font-semibold text-sm">Саморазвитие агента (Self-Improvement)</div>
                      <div className="text-xs text-muted-foreground">
                        {selfImproveEnabled
                          ? "Включено: агент имеет права на модификацию исходного кода интерфейса и пересборку."
                          : "Выключено: агент работает в безопасном режиме без прав записи в файлы UI (read-only)."}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch checked={!!selfImproveEnabled} onCheckedChange={handleToggleSelfImprove} disabled={!isAdminUser} />
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

                <div className="rounded-xl border border-border bg-card p-4 space-y-4">
                  <div>
                    <h4 className="font-semibold text-sm flex items-center gap-2">📸 Система чекпоинтов и управление версиями Git</h4>
                    <p className="text-xs text-muted-foreground mt-1">Создавайте контрольные снимки кода перед экспериментами агента или мгновенно откатывайтесь назад.</p>
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
                      ⚡ {rebuildStatus === "building..." ? "Билд..." : rebuildStatus === "success" ? "✓ Успешно!" : "Пересобрать UI"}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={!!resetStatus || !isAdminUser}
                      onClick={handleResetUI}
                    >
                      🔄 {resetStatus === "resetting..." ? "Сброс..." : resetStatus === "success" ? "✓ Сброшено!" : "Заводской сброс"}
                    </Button>
                  </div>

                  {rollbackStatus && (
                    <div className="text-xs px-3 py-2 rounded-lg border border-blue-500/30 bg-blue-500/10 text-blue-300">
                      {rollbackStatus}
                    </div>
                  )}

                  <div className="border-t border-border pt-3">
                    <div className="text-xs font-semibold text-muted-foreground mb-2">История чекпоинтов:</div>
                    <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
                      {checkpoints.length === 0 ? (
                        <div className="text-xs text-muted-foreground py-1">Нет сохранённых коммитов</div>
                      ) : checkpoints.map((cp) => (
                        <div key={cp.hash} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
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
                      ))}
                    </div>
                  </div>

                  <div className="border-t border-border pt-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs font-semibold text-muted-foreground">🖥️ Консоль событий (Логи самоулучшения):</div>
                      <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={loadAuditLogs} type="button">
                        Обновить 🔄
                      </Button>
                    </div>
                    <div className="max-h-44 overflow-y-auto rounded-lg bg-zinc-950 text-zinc-300 font-mono text-[11px] leading-relaxed p-3 border border-border">
                      {auditLogs.length === 0 ? (
                        <div className="text-zinc-500 italic">Лог событий пуст. Выполните действие, чтобы наполнить консоль.</div>
                      ) : auditLogs.map((log, index) => {
                        let color = "text-zinc-300";
                        if (log.includes("SUCCESS")) color = "text-emerald-400";
                        else if (log.includes("FAILED") || log.includes("WARNING")) color = "text-red-400";
                        else if (log.includes("START")) color = "text-sky-400";
                        return <div key={index} className={cn("whitespace-pre-wrap break-all", color)}>{log}</div>;
                      })}
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
                    <div className="h-9 w-9 rounded-full bg-amber-500 flex items-center justify-center">🎁</div>
                    <div>
                      <div className="font-semibold">Free Models</div>
                      <div className="text-xs text-muted-foreground">{ZEN_FREE_MODELS.length} free AI models via OpenCode Zen — one key unlocks all.</div>
                    </div>
                  </div>
                  <a className="text-sm text-primary hover:underline" href="https://opencode.ai/auth" target="_blank" rel="noreferrer">
                    Get a free key →
                  </a>
                </div>

                {zenConfigured && !editingZen ? (
                  <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm">
                    <span className="flex items-center gap-2 text-emerald-300"><CheckIcon size={16} /> OpenCode Zen connected — all free models available</span>
                    <div className="flex gap-3 text-xs">
                      <button className="text-primary hover:underline" onClick={() => { setEditingZen(true); setValues((v) => ({ ...v, [ZEN_PROVIDER_ID]: "" })); }} type="button">Change key</button>
                      <button className="text-muted-foreground hover:text-foreground" onClick={() => removeKey(ZEN_PROVIDER_ID)} type="button">Remove</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2 flex-wrap items-center">
                    <Input
                      type="password"
                      placeholder="Paste your OpenCode Zen API key"
                      value={values[ZEN_PROVIDER_ID] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [ZEN_PROVIDER_ID]: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && handleSave(ZEN_PROVIDER_ID).then((ok) => { if (ok) setEditingZen(false); })}
                      className="max-w-sm"
                      autoFocus={editingZen}
                    />
                    <Button disabled={!values[ZEN_PROVIDER_ID]?.trim() || saving === ZEN_PROVIDER_ID} onClick={() => { handleSave(ZEN_PROVIDER_ID).then((ok) => { if (ok) setEditingZen(false); }); }}>
                      {saving === ZEN_PROVIDER_ID ? "Connecting…" : (editingZen ? "Save key" : "Connect free models")}
                    </Button>
                    {editingZen && (
                      <Button variant="ghost" onClick={() => { setEditingZen(false); setValues((v) => ({ ...v, [ZEN_PROVIDER_ID]: "" })); }} type="button">Cancel</Button>
                    )}
                  </div>
                )}

                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {ZEN_FREE_MODELS.map((m) => (
                    <div key={m.id} className="rounded-xl border border-border bg-card p-3">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{m.badge}</span>
                        <span className="truncate">{m.name}</span>
                        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-semibold">FREE</span>
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
                  <span>Free models may use your data for training during the free period. Avoid using them for sensitive or commercial code.</span>
                </div>
              </div>
            )}

            {/* PROVIDERS TAB */}
            {activeTab === "providers" && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold">Bring your own API key</h3>
                  <p className="text-xs text-muted-foreground">Paid providers with zero data retention.</p>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  {PROVIDERS.map((p) => {
                    const configured = !!authed[p.id];
                    return (
                      <div key={p.id} className={cn("rounded-xl border p-3 bg-card", configured && "border-emerald-500/30")}>
                        <div className="flex items-center gap-3 mb-2">
                          <div className="h-8 w-8 rounded-lg flex items-center justify-center text-white text-sm font-bold" style={{ background: p.color }}>{p.name.charAt(0)}</div>
                          <div>
                            <div className="text-sm font-medium flex items-center gap-1.5">{p.name} {configured && <CheckIcon size={14} />}</div>
                            <div className="text-[11px] text-muted-foreground">{p.models}</div>
                          </div>
                        </div>
                        {configured && !editingProviders[p.id] ? (
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-emerald-400 flex items-center gap-1">🔑 API key connected</span>
                            <div className="flex gap-3">
                              <button className="text-primary hover:underline" onClick={() => { setEditingProviders((prev) => ({ ...prev, [p.id]: true })); setValues((v) => ({ ...v, [p.id]: "" })); }} type="button">Change</button>
                              <button className="text-muted-foreground hover:text-foreground" onClick={() => removeKey(p.id)} type="button">Remove</button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex gap-2 items-center flex-wrap">
                            <Input
                              type="password"
                              placeholder={p.keyHint}
                              value={values[p.id] ?? ""}
                              onChange={(e) => setValues((v) => ({ ...v, [p.id]: e.target.value }))}
                              onKeyDown={(e) => e.key === "Enter" && handleSave(p.id).then((ok) => { if (ok) setEditingProviders((prev) => ({ ...prev, [p.id]: false })); })}
                              className="flex-1 min-w-[180px] h-8"
                              autoFocus={editingProviders[p.id]}
                            />
                            <Button size="sm" disabled={!values[p.id]?.trim() || saving === p.id} onClick={() => { handleSave(p.id).then((ok) => { if (ok) setEditingProviders((prev) => ({ ...prev, [p.id]: false })); }); }}>
                              {saving === p.id ? "…" : (editingProviders[p.id] ? "Save" : "Connect")}
                            </Button>
                            {editingProviders[p.id] && (
                              <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => { setEditingProviders((prev) => ({ ...prev, [p.id]: false })); setValues((v) => ({ ...v, [p.id]: "" })); }} type="button">Cancel</button>
                            )}
                          </div>
                        )}
                        <a className="text-xs text-primary hover:underline mt-2 inline-block" href={p.docsUrl} target="_blank" rel="noreferrer">Get a key →</a>
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
                  <div className="h-9 w-9 rounded-full bg-sky-600 flex items-center justify-center text-white">ℹ️</div>
                  <div>
                    <div className="font-semibold">OpenCode UI (Cloud Edition)</div>
                    <div className="text-xs text-muted-foreground">Веб-интерфейс нового поколения для AI-агента OpenCode.</div>
                  </div>
                </div>
                {[
                  ["Версия билда:", "v17-secured-20260706"],
                  ["Стек технологий:", "React 19 + Vite + Zustand + TypeScript + Tailwind"],
                  ["Рабочая директория (Volume):", "/app/workspace"],
                  ["Безопасность (Basic Auth):", "● Защищено на сервере"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between items-center rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm">
                    <span className="text-muted-foreground">{k}</span>
                    <code className="text-xs">{v}</code>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
