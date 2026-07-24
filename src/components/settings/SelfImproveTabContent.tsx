import SelfImprovePRsList from "../SelfImprovePRsList";
import { DbBackupCard } from "./DbBackupCard";
import { GitCheckpointsCard } from "./GitCheckpointsCard";
import { InstantRollbackCard } from "./InstantRollbackCard";
import { SelfImproveToggleCard } from "./SelfImproveToggleCard";
import { ServerHealthCard } from "./ServerHealthCard";
import type { useSelfImproveOps } from "./useSelfImproveOps";

type SelfImproveOps = ReturnType<typeof useSelfImproveOps>;

/**
 * Composes all "Саморазвитие" (self-improve) settings-tab cards from the
 * shared useSelfImproveOps() state/handlers bag. Kept purely presentational —
 * all data loading, polling, and mutation logic lives in the hook.
 */
export function SelfImproveTabContent({ ops }: { ops: SelfImproveOps }) {
  return (
    <div className="space-y-4">
      {ops.isAdminUser && <SelfImprovePRsList visible={true} />}

      <ServerHealthCard
        health={ops.health}
        healthError={ops.healthError}
        loadHealth={ops.loadHealth}
        currentUser={ops.currentUser}
        selfImproveEnabled={ops.selfImproveEnabled}
      />

      {ops.isAdminUser && (
        <DbBackupCard
          dbBackups={ops.dbBackups}
          backupStatus={ops.backupStatus}
          handleCreateBackup={ops.handleCreateBackup}
          selfImproveEnabled={ops.selfImproveEnabled}
          restoreStatus={ops.restoreStatus}
          handleRestoreBackup={ops.handleRestoreBackup}
        />
      )}

      {!ops.isAdminUser && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-200">
          Саморазвитие меняет исходный код интерфейса для всех пользователей
          этого сервера, поэтому доступно только администратору. Ваш аккаунт:{" "}
          {ops.currentUser?.role || "user"}.
        </div>
      )}

      <SelfImproveToggleCard
        selfImproveEnabled={ops.selfImproveEnabled}
        toggleBusy={ops.toggleBusy}
        handleToggleSelfImprove={ops.handleToggleSelfImprove}
        isAdminUser={ops.isAdminUser}
      />

      {ops.isAdminUser && (
        <InstantRollbackCard
          distSnapshots={ops.distSnapshots}
          instantStatus={ops.instantStatus}
          handleInstantRollback={ops.handleInstantRollback}
          selfImproveEnabled={ops.selfImproveEnabled}
        />
      )}

      <GitCheckpointsCard
        isAdminUser={ops.isAdminUser}
        loadSourceDiff={ops.loadSourceDiff}
        checkpointStatus={ops.checkpointStatus}
        selfImproveEnabled={ops.selfImproveEnabled}
        handleCreateCheckpoint={ops.handleCreateCheckpoint}
        rebuildStatus={ops.rebuildStatus}
        handleRebuild={ops.handleRebuild}
        resetStatus={ops.resetStatus}
        handleResetUI={ops.handleResetUI}
        sourceDiff={ops.sourceDiff}
        diffStatus={ops.diffStatus}
        rollbackStatus={ops.rollbackStatus}
        checkpoints={ops.checkpoints}
        handleRollback={ops.handleRollback}
        auditLogs={ops.auditLogs}
        loadAuditLogs={ops.loadAuditLogs}
      />
    </div>
  );
}
