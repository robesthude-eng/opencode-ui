import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { HealthInfo } from "./useSelfImproveOps";

type CurrentUser = { email?: string; role?: string } | null | undefined;

export function ServerHealthCard({
	health,
	healthError,
	loadHealth,
	currentUser,
	selfImproveEnabled,
}: {
	health: HealthInfo | null;
	healthError: string | null;
	loadHealth: () => void;
	currentUser: CurrentUser;
	selfImproveEnabled: boolean;
}) {
	return (
		<div className="rounded-xl border border-border bg-card p-4">
			<div className="flex items-center justify-between gap-3 mb-3">
				<h4 className="font-semibold text-sm flex items-center gap-2">🩺 Состояние сервера</h4>
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
				<span className="font-medium text-foreground">{currentUser?.role || "user"}</span>
				{selfImproveEnabled ? " · саморазвитие ●" : " · саморазвитие ○"}
			</p>
		</div>
	);
}
