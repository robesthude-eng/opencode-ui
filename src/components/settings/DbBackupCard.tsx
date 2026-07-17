import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getDeployGroupColor } from "./deployGroupColor";
import type { DbBackup } from "./useSelfImproveOps";

export function DbBackupCard({
	dbBackups,
	backupStatus,
	handleCreateBackup,
	selfImproveEnabled,
	restoreStatus,
	handleRestoreBackup,
}: {
	dbBackups: DbBackup[];
	backupStatus: string | null;
	handleCreateBackup: () => void;
	selfImproveEnabled: boolean;
	restoreStatus: string | null;
	handleRestoreBackup: (name: string) => void;
}) {
	return (
		<div className="rounded-xl border border-border bg-card p-4 space-y-3">
			<div className="flex items-start justify-between gap-3">
				<div>
					<h4 className="font-semibold text-sm flex items-center gap-2">💾 Бэкап базы (SQLite)</h4>
					<p className="text-xs text-muted-foreground mt-1">
						Снимок users/sessions на volume. Автоматически раз в сутки + вручную.
					</p>
				</div>
				<Button
					size="sm"
					variant="outline"
					className="shrink-0"
					disabled={!!backupStatus}
					onClick={handleCreateBackup}
				>
					{backupStatus || "Создать бэкап"}
				</Button>
			</div>
			<div className="max-h-28 overflow-y-auto space-y-1">
				{dbBackups.length === 0 ? (
					<p className="text-[11px] text-muted-foreground">
						Бэкапов пока нет. Нажмите «Создать бэкап» или дождитесь ночного снимка.
					</p>
				) : (
					dbBackups.slice(0, 8).map((b) => {
						const groupColor = getDeployGroupColor(b.name);
						return (
							<div
								key={b.name}
								className={cn(
									"flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[11px]",
									groupColor || "border-border bg-muted/30",
								)}
							>
								<span className="font-mono truncate min-w-0" title={b.name}>
									{b.name}
								</span>
								<div className="flex items-center gap-2 shrink-0">
									<span className="text-muted-foreground">{(b.bytes / 1024).toFixed(1)} KB</span>
									<a
										className="text-primary hover:underline mr-1"
										href={`/api/db/backups/${encodeURIComponent(b.name)}`}
										download={b.name}
									>
										Скачать
									</a>
									{selfImproveEnabled && (
										<Button
											variant="outline"
											size="sm"
											className="h-5 text-[10px] shrink-0"
											disabled={!!restoreStatus}
											onClick={() => handleRestoreBackup(b.name)}
										>
											{restoreStatus === b.name ? "Откат..." : "Восстановить"}
										</Button>
									)}
								</div>
							</div>
						);
					})
				)}
			</div>
		</div>
	);
}
