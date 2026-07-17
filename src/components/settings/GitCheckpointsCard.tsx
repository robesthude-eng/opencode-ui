import { Button } from "@/components/ui/button";
import { AuditLogConsole } from "./AuditLogConsole";
import type { GitCheckpoint } from "./useSelfImproveOps";

export function GitCheckpointsCard({
	isAdminUser,
	loadSourceDiff,
	checkpointStatus,
	selfImproveEnabled,
	handleCreateCheckpoint,
	rebuildStatus,
	handleRebuild,
	resetStatus,
	handleResetUI,
	sourceDiff,
	diffStatus,
	rollbackStatus,
	checkpoints,
	handleRollback,
	auditLogs,
	loadAuditLogs,
}: {
	isAdminUser: boolean;
	loadSourceDiff: () => void;
	checkpointStatus: string | null;
	selfImproveEnabled: boolean;
	handleCreateCheckpoint: () => void;
	rebuildStatus: string | null;
	handleRebuild: () => void;
	resetStatus: string | null;
	handleResetUI: () => void;
	sourceDiff: string | null;
	diffStatus: string | null;
	rollbackStatus: string | null;
	checkpoints: GitCheckpoint[];
	handleRollback: (hash: string) => void;
	auditLogs: string[];
	loadAuditLogs: () => void;
}) {
	return (
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
				<Button variant="outline" size="sm" disabled={!isAdminUser} onClick={loadSourceDiff}>
					🔎 Просмотреть diff
				</Button>
				<Button
					size="sm"
					disabled={!!checkpointStatus || !selfImproveEnabled || !isAdminUser}
					onClick={handleCreateCheckpoint}
				>
					{checkpointStatus ? checkpointStatus : <>📸 Создать чекпоинт</>}
				</Button>
				<Button variant="outline" size="sm" disabled={!!rebuildStatus || !isAdminUser} onClick={handleRebuild}>
					⚡{" "}
					{rebuildStatus === "building..."
						? "Билд…"
						: rebuildStatus === "success"
							? "✓ Готово"
							: "Пересобрать UI"}
				</Button>
				<Button variant="destructive" size="sm" disabled={!!resetStatus || !isAdminUser} onClick={handleResetUI}>
					🔄{" "}
					{resetStatus === "resetting..."
						? "Сброс…"
						: resetStatus === "success"
							? "✓ Сброшено"
							: "Заводской сброс"}
				</Button>
			</div>

			{sourceDiff !== null && (
				<div className="rounded-lg border border-border bg-zinc-950 p-3">
					<div className="mb-2 text-xs font-medium text-muted-foreground">{diffStatus}</div>
					<pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-zinc-200">
						{sourceDiff || "Нет изменений в src/**"}
					</pre>
				</div>
			)}

			{(rollbackStatus ||
				(rebuildStatus && rebuildStatus !== "building..." && rebuildStatus !== "success")) && (
				<div className="text-xs px-3 py-2 rounded-lg border border-blue-500/30 bg-blue-500/10 text-blue-300">
					{rollbackStatus || rebuildStatus}
				</div>
			)}

			<div className="border-t border-border pt-3">
				<div className="text-xs font-semibold text-muted-foreground mb-2">История чекпоинтов:</div>
				<div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
					{checkpoints.length === 0 ? (
						<div className="text-xs text-muted-foreground py-1">Нет сохранённых коммитов</div>
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

			<AuditLogConsole auditLogs={auditLogs} loadAuditLogs={loadAuditLogs} />
		</div>
	);
}
