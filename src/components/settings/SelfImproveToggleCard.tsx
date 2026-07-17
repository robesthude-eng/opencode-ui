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
  handleToggleSelfImprove: () => void;
  isAdminUser: boolean;
}) {
  return (
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
          onCheckedChange={() => {
            void handleToggleSelfImprove();
          }}
          disabled={!isAdminUser || toggleBusy}
        />
        <button
          type="button"
          className="text-sm w-24 text-right hover:opacity-80 disabled:opacity-50"
          onClick={() => {
            void handleToggleSelfImprove();
          }}
          disabled={!isAdminUser || toggleBusy}
        >
          {toggleBusy ? "…" : selfImproveEnabled ? "● Включено" : "○ Выключено"}
        </button>
      </div>
    </div>
  );
}
