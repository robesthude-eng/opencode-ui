import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export function SelfImproveToggleCard({
  selfImproveEnabled,
  toggleBusy,
  handleToggleSelfImprove,
  isAdminUser,
}: {
  selfImproveEnabled: boolean;
  toggleBusy: boolean;
  handleToggleSelfImprove: () => void | Promise<void>;
  isAdminUser: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
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
          onCheckedChange={() => {
            Promise.resolve(handleToggleSelfImprove()).catch(() => {});
          }}
          disabled={!isAdminUser || toggleBusy}
        />
        <button
          type="button"
          className="text-sm w-24 text-right hover:opacity-80 disabled:opacity-50"
          onClick={() => {
            Promise.resolve(handleToggleSelfImprove()).catch(() => {});
          }}
          disabled={!isAdminUser || toggleBusy}
        >
          <span className="inline-flex items-center gap-1.5">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                selfImproveEnabled ? "bg-emerald-400" : "bg-muted-foreground",
              )}
            />
            {toggleBusy ? "…" : selfImproveEnabled ? "Включено" : "Выключено"}
          </span>
        </button>
      </div>
    </div>
  );
}
