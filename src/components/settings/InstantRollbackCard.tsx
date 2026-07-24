import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getDeployGroupColor } from "./deployGroupColor";
import type { DistSnapshot } from "./useSelfImproveOps";

export function InstantRollbackCard({
  distSnapshots,
  instantStatus,
  handleInstantRollback,
  selfImproveEnabled,
}: {
  distSnapshots: DistSnapshot[];
  instantStatus: string | null;
  handleInstantRollback: (index?: number) => void;
  selfImproveEnabled: boolean;
}) {
  return (
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
          distSnapshots.map((s, i) => {
            const groupColor = getDeployGroupColor(s.name);
            return (
              <div
                key={s.name}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[11px]",
                  groupColor || "border-border bg-background/60",
                )}
              >
                <div className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="shrink-0 font-mono text-primary">
                    {s.current ? "текущая" : `−${i}`}
                  </span>
                  <span className="min-w-0 truncate text-muted-foreground">
                    {s.name}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {s.time ? new Date(s.time).toLocaleString() : ""}
                  </span>
                </div>
                {!s.current && selfImproveEnabled && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[11px] shrink-0"
                    disabled={!!instantStatus}
                    onClick={() => {
                      // Сервер всегда ставит current первым и берёт
                      // entries[index + 1], поэтому для строки i — ровно i - 1.
                      handleInstantRollback(i - 1);
                    }}
                  >
                    Восстановить
                  </Button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
