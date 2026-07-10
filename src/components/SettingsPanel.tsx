import { useEffect, useState } from "react";
import { useStore } from "../store/useStore";
import { PROVIDERS, ZEN_FREE_MODELS, ZEN_PROVIDER_ID } from "../config/providers";
import { CloseIcon, CheckIcon, KeyIcon, GiftIcon, WarningIcon } from "./icons";

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
  // Self-improvement mutates the UI source shared by every user of this
  // deployment (rebuild/rollback/write permissions), so it's restricted to the
  // admin account server-side. Mirror that here so the controls aren't shown
  // as usable to accounts that will just get a 403 back.
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
        // Revert the optimistic flip — most commonly a 403 because this
        // account isn't an admin.
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

  return (
    <div className="overlay" onClick={() => setOpen(false)}>
      <div className="settings" onClick={(e) => e.stopPropagation()}>
        {/* Left Sidebar Tabs */}
        <aside className="settings-sidebar">
          <div className="settings-sidebar-head">
            <h2>Настройки</h2>
          </div>
          <nav className="settings-nav">
            <button
              className={`settings-nav-item ${activeTab === "self-improve" ? "active" : ""}`}
              onClick={() => setActiveTab("self-improve")}
              type="button"
            >
              <span>🤖</span> Саморазвитие
            </button>
            <button
              className={`settings-nav-item ${activeTab === "free-models" ? "active" : ""}`}
              onClick={() => setActiveTab("free-models")}
              type="button"
            >
              <span>🎁</span> OpenCode Zen
            </button>
            <button
              className={`settings-nav-item ${activeTab === "providers" ? "active" : ""}`}
              onClick={() => setActiveTab("providers")}
              type="button"
            >
              <span>🔑</span> API Провайдеры
            </button>
            <button
              className={`settings-nav-item ${activeTab === "about" ? "active" : ""}`}
              onClick={() => setActiveTab("about")}
              type="button"
            >
              <span>ℹ️</span> О системе
            </button>
          </nav>
        </aside>

        {/* Right Content Area */}
        <div className="settings-content">
          <header className="settings-content-head">
            <h3>
              {activeTab === "self-improve" && "Режим саморазвития (Self-Improvement)"}
              {activeTab === "free-models" && "Бесплатные модели (OpenCode Zen)"}
              {activeTab === "providers" && "Подключение сторонних API провайдеров"}
              {activeTab === "about" && "О системе и архитектуре"}
            </h3>
            <button className="icon-btn" onClick={() => setOpen(false)} title="Close" type="button">
              <CloseIcon />
            </button>
          </header>

          <div className="settings-content-body">
            {activeTab === "self-improve" && (
              <section className="zen-section" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {!isAdminUser && (
                  <div
                    className="muted small"
                    style={{ padding: 12, background: "var(--bg)", border: "1px solid var(--border-soft)", borderRadius: 10 }}
                  >
                    🔒 Саморазвитие меняет исходный код интерфейса для всех пользователей этого сервера, поэтому доступно только администратору.
                    Ваш аккаунт: {currentUser?.role || "user"}.
                  </div>
                )}
                <div className="zen-header">
                  <div className="zen-title">
                    <span
                      className="zen-badge-icon"
                      style={{
                        background: selfImproveEnabled ? "var(--green)" : "var(--muted)",
                        color: "#fff",
                      }}
                    >
                      🤖
                    </span>
                    <div>
                      <h3>Саморазвитие агента (Self-Improvement)</h3>
                      <p className="muted small">
                        {selfImproveEnabled
                          ? "Включено: агент имеет права на модификацию исходного кода интерфейса и пересборку."
                          : "Выключено: агент работает в безопасном режиме без прав записи в файлы UI (read-only)."}
                      </p>
                    </div>
                  </div>
                  <button
                    className={`btn-primary ${selfImproveEnabled ? "active" : ""}`}
                    style={{
                      background: selfImproveEnabled ? "var(--green)" : "var(--bg-hover)",
                      color: selfImproveEnabled ? "#fff" : "var(--text)",
                      border: "1px solid var(--border)",
                      minWidth: "140px",
                      transition: "all 0.15s",
                      cursor: "pointer",
                    }}
                    onClick={handleToggleSelfImprove}
                    disabled={!isAdminUser}
                    type="button"
                  >
                    {selfImproveEnabled ? "● Включено" : "○ Выключено"}
                  </button>
                </div>

                <div style={{ padding: 16, background: "var(--bg)", borderRadius: 12, border: "1px solid var(--border-soft)", display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <h4 style={{ margin: "0 0 4px", fontSize: 14, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                      <span>📸</span> Система чекпоинтов и управление версиями Git
                    </h4>
                    <p className="muted small" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>
                      Создавайте контрольные снимки кода перед экспериментами агента или мгновенно откатывайтесь назад.
                    </p>
                  </div>

                  <div className="checkpoint-actions">
                    <button
                      className="btn-primary sm"
                      style={{ background: "var(--blue)", color: "#fff", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", border: "none", padding: "8px 14px", borderRadius: 8, fontWeight: 600, fontSize: 13 }}
                      onClick={handleCreateCheckpoint}
                      disabled={!!checkpointStatus || !selfImproveEnabled || !isAdminUser}
                      type="button"
                    >
                      <span>📸</span>
                      {checkpointStatus || "Создать чекпоинт"}
                    </button>

                    <button
                      className="btn-ghost sm"
                      style={{ color: "var(--text)", borderColor: "var(--border)", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", padding: "8px 12px", borderRadius: 8, fontWeight: 600, fontSize: 12.5, background: "transparent" }}
                      onClick={handleRebuild}
                      disabled={!!rebuildStatus || !isAdminUser}
                      type="button"
                    >
                      <span>⚡</span>
                      {rebuildStatus === "building..." ? "Билд..." : rebuildStatus === "success" ? "✓ Успешно!" : "Пересобрать UI"}
                    </button>

                    <button
                      className="btn-ghost sm"
                      style={{ color: "var(--red)", borderColor: "color-mix(in srgb, var(--red) 40%, transparent)", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", padding: "8px 12px", borderRadius: 8, fontWeight: 600, fontSize: 12.5, background: "transparent" }}
                      onClick={handleResetUI}
                      disabled={!!resetStatus || !isAdminUser}
                      type="button"
                    >
                      <span>🔄</span>
                      {resetStatus === "resetting..." ? "Сброс..." : resetStatus === "success" ? "✓ Сброшено!" : "Заводской сброс"}
                    </button>
                  </div>

                  {rollbackStatus && (
                    <div style={{ fontSize: 12.5, padding: "8px 12px", color: "var(--blue)", background: "var(--bg-subtle)", borderRadius: 6, border: "1px solid var(--blue)" }}>
                      {rollbackStatus}
                    </div>
                  )}

                  <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginBottom: 8 }}>
                      История чекпоинтов:
                    </div>
                    <div style={{ maxHeight: 180, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                      {checkpoints.length === 0 ? (
                        <div style={{ fontSize: 12, color: "var(--text-2)", padding: 6 }}>Нет сохранённых коммитов</div>
                      ) : (
                        checkpoints.map((cp) => (
                          <div key={cp.hash} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: "var(--bg-subtle)", borderRadius: 8, border: "1px solid var(--border-soft)", gap: 10 }}>
                            <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                <span style={{ color: "var(--blue)", marginRight: 6, fontFamily: "monospace" }}>[{cp.hash}]</span>
                                {cp.subject}
                              </span>
                              <span style={{ fontSize: 11, color: "var(--text-2)" }}>{cp.time}</span>
                            </div>
                            {selfImproveEnabled && isAdminUser && (
                              <button
                                style={{ fontSize: 11.5, padding: "4px 8px", background: "transparent", color: "var(--red)", border: "1px solid var(--red)", borderRadius: 6, cursor: "pointer", fontWeight: 600, flexShrink: 0, transition: "all 0.15s" }}
                                onClick={() => handleRollback(cp.hash)}
                                title={`Откатить UI к коммиту ${cp.hash}`}
                              >
                                🔄 Откатить
                              </button>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 12, marginTop: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>🖥️ Консоль событий (Логи самоулучшения):</span>
                      <button 
                        style={{ fontSize: 11, background: "transparent", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer", color: "var(--text-2)", padding: "2px 6px" }}
                        onClick={loadAuditLogs}
                        type="button"
                      >
                        Обновить 🔄
                      </button>
                    </div>
                    <div style={{ 
                      maxHeight: 180, 
                      overflowY: "auto", 
                      background: "#1e1e1e", 
                      color: "#d4d4d4", 
                      padding: "10px 12px", 
                      borderRadius: 8, 
                      fontFamily: "monospace", 
                      fontSize: "11.5px", 
                      lineHeight: "1.5", 
                      display: "flex", 
                      flexDirection: "column", 
                      gap: 4,
                      border: "1px solid var(--border-soft)"
                    }}>
                      {auditLogs.length === 0 ? (
                        <div style={{ color: "#808080", fontStyle: "italic" }}>Лог событий пуст. Выполните действие, чтобы наполнить консоль.</div>
                      ) : (
                        auditLogs.map((log, index) => {
                          let color = "#d4d4d4";
                          if (log.includes("SUCCESS")) color = "#4ec9b0";
                          else if (log.includes("FAILED") || log.includes("WARNING")) color = "#f44336";
                          else if (log.includes("START")) color = "#569cd6";
                          
                          return (
                            <div key={index} style={{ color, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                              {log}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {activeTab === "free-models" && (
              <section className="zen-section">
                <div className="zen-header">
                  <div className="zen-title">
                    <span className="zen-badge-icon">
                      <GiftIcon size={18} />
                    </span>
                    <div>
                      <h3>Free Models</h3>
                      <p className="muted small">
                        {ZEN_FREE_MODELS.length} free AI models via OpenCode Zen — one key unlocks all.
                      </p>
                    </div>
                  </div>
                  <a
                    className="get-key"
                    href="https://opencode.ai/auth"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Get a free key →
                  </a>
                </div>

                {zenConfigured && !editingZen ? (
                  <div className="zen-connected">
                    <span className="key-line">
                      <CheckIcon size={16} /> OpenCode Zen connected — all free models available
                    </span>
                    <span className="key-actions" style={{ display: "flex", gap: "8px" }}>
                      <button
                        className="link-btn"
                        onClick={() => {
                          setEditingZen(true);
                          setValues((v) => ({ ...v, [ZEN_PROVIDER_ID]: "" }));
                        }}
                        type="button"
                      >
                        Change key
                      </button>
                      <button className="link-btn" onClick={() => removeKey(ZEN_PROVIDER_ID)} type="button">
                        Remove
                      </button>
                    </span>
                  </div>
                ) : (
                  <div className="zen-connect">
                    <input
                      type="password"
                      placeholder="Paste your OpenCode Zen API key"
                      value={values[ZEN_PROVIDER_ID] ?? ""}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [ZEN_PROVIDER_ID]: e.target.value }))
                      }
                      onKeyDown={(e) => e.key === "Enter" && handleSave(ZEN_PROVIDER_ID).then((ok) => {
                        if (ok) setEditingZen(false);
                      })}
                      autoFocus={editingZen}
                    />
                    <button
                      className="btn-primary"
                      disabled={!values[ZEN_PROVIDER_ID]?.trim() || saving === ZEN_PROVIDER_ID}
                      onClick={() => {
                        handleSave(ZEN_PROVIDER_ID).then((ok) => {
                          if (ok) setEditingZen(false);
                        });
                      }}
                      type="button"
                    >
                      {saving === ZEN_PROVIDER_ID ? "Connecting…" : (editingZen ? "Save key" : "Connect free models")}
                    </button>
                    {editingZen && (
                      <button
                        className="btn-ghost sm"
                        style={{
                          padding: "8px 12px",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          cursor: "pointer",
                          background: "transparent",
                          color: "var(--text)",
                        }}
                        onClick={() => {
                          setEditingZen(false);
                          setValues((v) => ({ ...v, [ZEN_PROVIDER_ID]: "" }));
                        }}
                        type="button"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                )}

                <div className="free-models-grid">
                  {ZEN_FREE_MODELS.map((m) => (
                    <div className="free-model" key={m.id}>
                      <div className="free-model-top">
                        <span className={`tier-badge tier-${m.badge}`}>{m.badge}</span>
                        <span className="free-model-name">{m.name}</span>
                        <span className="free-tag">FREE</span>
                      </div>
                      <p className="free-model-best muted small">{m.best}</p>
                      <div className="free-model-stats">
                        <span className="stat">⏷ {m.context} ctx</span>
                        {m.sweBench && <span className="stat">◆ {m.sweBench} SWE</span>}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="zen-warning">
                  <WarningIcon size={14} />
                  <span className="muted small">
                    Free models may use your data for training during the free period.
                    Avoid using them for sensitive or commercial code.
                  </span>
                </div>
              </section>
            )}

            {activeTab === "providers" && (
              <div>
                <div className="provider-section-title" style={{ marginBottom: 16 }}>
                  <h3>Bring your own API key</h3>
                  <p className="muted small">Paid providers with zero data retention.</p>
                </div>

                <div className="provider-grid">
                  {PROVIDERS.map((p) => {
                    const configured = !!authed[p.id];
                    return (
                      <div className={`provider ${configured ? "configured" : ""}`} key={p.id}>
                        <div className="provider-head">
                          <span className="provider-badge" style={{ background: p.color }}>
                            {p.name.charAt(0)}
                          </span>
                          <div className="provider-meta">
                            <span className="provider-name">
                              {p.name}
                              {configured && <CheckIcon size={14} />}
                            </span>
                            <span className="provider-models muted small">{p.models}</span>
                          </div>
                        </div>

                        {configured && !editingProviders[p.id] ? (
                          <div className="provider-configured">
                            <span className="key-line">
                              <KeyIcon size={14} /> API key connected
                            </span>
                            <span className="key-actions" style={{ display: "flex", gap: "8px" }}>
                              <button
                                className="link-btn"
                                onClick={() => {
                                  setEditingProviders((prev) => ({ ...prev, [p.id]: true }));
                                  setValues((v) => ({ ...v, [p.id]: "" }));
                                }}
                                type="button"
                              >
                                Change
                              </button>
                              <button className="link-btn" onClick={() => removeKey(p.id)} type="button">
                                Remove
                              </button>
                            </span>
                          </div>
                        ) : (
                          <div className="provider-input">
                            <input
                              type="password"
                              placeholder={p.keyHint}
                              value={values[p.id] ?? ""}
                              onChange={(e) =>
                                setValues((v) => ({ ...v, [p.id]: e.target.value }))
                              }
                              onKeyDown={(e) =>
                                e.key === "Enter" &&
                                handleSave(p.id).then((ok) => {
                                  if (ok) setEditingProviders((prev) => ({ ...prev, [p.id]: false }));
                                })
                              }
                              autoFocus={editingProviders[p.id]}
                            />
                            <button
                              className="btn-primary sm"
                              disabled={!values[p.id]?.trim() || saving === p.id}
                              onClick={() => {
                                handleSave(p.id).then((ok) => {
                                  if (ok) setEditingProviders((prev) => ({ ...prev, [p.id]: false }));
                                });
                              }}
                              type="button"
                            >
                              {saving === p.id ? "…" : (editingProviders[p.id] ? "Save" : "Connect")}
                            </button>
                            {editingProviders[p.id] && (
                              <button
                                className="link-btn"
                                style={{ fontSize: "12px", color: "var(--text-2)" }}
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

                        <a className="get-key" href={p.docsUrl} target="_blank" rel="noreferrer">
                          Get a key →
                        </a>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {activeTab === "about" && (
              <section className="zen-section">
                <div className="zen-header">
                  <div className="zen-title">
                    <span className="zen-badge-icon" style={{ background: "var(--blue)", color: "#fff" }}>
                      ℹ️
                    </span>
                    <div>
                      <h3>OpenCode UI (Cloud Edition)</h3>
                      <p className="muted small">Веб-интерфейс нового поколения для AI-агента OpenCode.</p>
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12, fontSize: 13, color: "var(--text-2)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", background: "var(--bg)", borderRadius: 8, border: "1px solid var(--border-soft)" }}>
                    <span>Версия билда:</span>
                    <code>v17-secured-20260706</code>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", background: "var(--bg)", borderRadius: 8, border: "1px solid var(--border-soft)" }}>
                    <span>Стек технологий:</span>
                    <span>React 18 + Vite + Zustand + TypeScript</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", background: "var(--bg)", borderRadius: 8, border: "1px solid var(--border-soft)" }}>
                    <span>Рабочая директория (Volume):</span>
                    <code>/app/workspace</code>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", background: "var(--bg)", borderRadius: 8, border: "1px solid var(--border-soft)" }}>
                    <span>Безопасность (Basic Auth):</span>
                    <span style={{ color: "var(--green)", fontWeight: 600 }}>● Защищено на сервере</span>
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
