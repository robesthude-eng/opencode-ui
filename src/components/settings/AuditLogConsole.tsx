import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AuditLogConsole({
  auditLogs,
  loadAuditLogs,
}: {
  auditLogs: string[];
  loadAuditLogs: () => void;
}) {
  return (
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
              <div
                key={index}
                className={cn("whitespace-pre-wrap break-all", color)}
              >
                {log}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
