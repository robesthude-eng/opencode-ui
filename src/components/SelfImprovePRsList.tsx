import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";

type PR = Awaited<ReturnType<typeof api.listSelfImprovePRs>>["prs"][number];

/**
 * Список Pull Requests, созданных ассистентом через /api/self-improve/create-pr.
 * Автообновление раз в 30 сек когда виден. Ручное обновление по кнопке.
 */
export default function SelfImprovePRsList({ visible }: { visible: boolean }) {
  const [prs, setPrs] = useState<PR[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.listSelfImprovePRs("all");
      setPrs(r.prs || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [visible, load]);

  if (!visible) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <span>🔀</span>
            <span>Автоматические Pull Requests</span>
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            PR'ы, которые ассистент создал через /api/self-improve/create-pr
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition disabled:opacity-50 shrink-0"
        >
          {loading ? "Обновляю…" : "Обновить"}
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
          {typeof error === "string" ? error : JSON.stringify(error)}
        </div>
      )}

      {!error && prs.length === 0 && !loading && (
        <div className="text-xs text-muted-foreground italic py-3">
          Пока PR'ов нет. Ассистент создаст их через <code>create-pr</code>,
          когда ты попросишь что-то улучшить в UI.
        </div>
      )}

      {prs.length > 0 && (
        <ul className="space-y-1">
          {prs.map((pr) => {
            const stateIcon = pr.merged
              ? "🟣"
              : pr.state === "open"
                ? "🟢"
                : "🔴";
            const stateLabel = pr.merged
              ? "merged"
              : pr.state === "open"
                ? pr.auto_merge
                  ? "open · auto-merge"
                  : "open"
                : "closed";
            return (
              <li key={pr.number}>
                <a
                  href={pr.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/60 transition group"
                >
                  <span className="text-sm shrink-0 mt-0.5" title={stateLabel}>
                    {stateIcon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium truncate group-hover:text-primary">
                      #{pr.number} · {pr.title}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {pr.head_branch} · {stateLabel} ·{" "}
                      {new Date(pr.updated_at).toLocaleString()}
                    </div>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
