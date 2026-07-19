/**
 * SQLite backup helpers for opencode.db.
 * Prefer better-sqlite3 `.backup()` (async API wrapped), else file copy after WAL checkpoint.
 */
import fs from "node:fs";
import path from "node:path";
import { getSqlite } from "./db.mjs";

const MAX_BACKUPS = 14; // keep ~2 weeks if daily

export function getBackupDir(workdir) {
  return path.join(
    workdir || process.env.OPENCODE_WORKDIR || "/app/workspace",
    "backups",
  );
}

/**
 * Create a timestamped backup of opencode.db under $WORKDIR/backups/.
 * Synchronous for simple admin/API use (uses file copy after checkpoint).
 * @returns {{ path: string, bytes: number, name: string }}
 */
export function createDbBackup(workdir) {
  const root = workdir || process.env.OPENCODE_WORKDIR || "/app/workspace";
  const dbFile = path.join(root, "opencode.db");
  if (!fs.existsSync(dbFile)) {
    throw new Error("opencode.db not found — nothing to backup yet");
  }

  const dir = getBackupDir(root);
  fs.mkdirSync(dir, { recursive: true });

  // Include ms + random suffix so two backups in the same second never collide
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = Math.random().toString(36).slice(2, 6);
  const name = `opencode-${stamp}-${suffix}.db`;
  const dest = path.join(dir, name);

  const db = getSqlite();
  // Checkpoint WAL so the main file is consistent, then copy.
  // (better-sqlite3 backup() is async/promise-based — avoid in sync request path.)
  try {
    if (db) db.pragma("wal_checkpoint(TRUNCATE)");
  } catch {
    /* ignore */
  }
  fs.copyFileSync(dbFile, dest);

  const bytes = fs.statSync(dest).size;
  pruneBackups(dir, MAX_BACKUPS);
  return { path: dest, bytes, name };
}

export function listDbBackups(workdir) {
  const dir = getBackupDir(workdir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.startsWith("opencode-") && n.endsWith(".db"))
    .map((n) => {
      const p = path.join(dir, n);
      const st = fs.statSync(p);
      return {
        name: n,
        path: p,
        bytes: st.size,
        mtime: st.mtimeMs,
        time: st.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function pruneBackups(dir, keep) {
  const files = fs
    .readdirSync(dir)
    .filter((n) => n.startsWith("opencode-") && n.endsWith(".db"))
    .map((n) => ({ n, m: fs.statSync(path.join(dir, n)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  for (const old of files.slice(keep)) {
    try {
      fs.unlinkSync(path.join(dir, old.n));
    } catch {
      /* ignore */
    }
  }
}

/**
 * Resolve a backup file by basename only (no path traversal).
 * @returns {string|null} absolute path or null
 */
export function resolveBackupFile(workdir, name) {
  if (!name || typeof name !== "string") return null;
  if (!/^opencode-[\w.-]+\.db$/.test(name)) return null;
  if (name.includes("..") || name.includes("/") || name.includes("\\"))
    return null;
  const full = path.join(getBackupDir(workdir), name);
  if (!fs.existsSync(full)) return null;
  // ensure still inside backups dir
  const dir = path.resolve(getBackupDir(workdir));
  if (
    !path.resolve(full).startsWith(dir + path.sep) &&
    path.resolve(full) !== dir
  ) {
    return null;
  }
  return full;
}

import { closeDb, initDb } from "./db.mjs";

/**
 * Restore the SQLite database opencode.db from a timestamped backup file.
 */
export function restoreDbBackup(workdir, name) {
  const root = workdir || process.env.OPENCODE_WORKDIR || "/app/workspace";
  const dbFile = path.join(root, "opencode.db");
  const backupFile = resolveBackupFile(workdir, name);
  if (!backupFile) {
    throw new Error("Backup file not found or invalid name");
  }

  closeDb();

  try {
    if (fs.existsSync(dbFile)) {
      fs.unlinkSync(dbFile);
    }
    const walFile = `${dbFile}-wal`;
    if (fs.existsSync(walFile)) {
      fs.unlinkSync(walFile);
    }
    const shmFile = `${dbFile}-shm`;
    if (fs.existsSync(shmFile)) {
      fs.unlinkSync(shmFile);
    }
  } catch (e) {
    console.error(
      "[Backup] Failed to remove active DB files during restore:",
      e.message,
    );
  }

  fs.copyFileSync(backupFile, dbFile);
  initDb(root);

  console.log(`[Backup] Successfully restored database from backup: ${name}`);
  return { status: "success", name };
}

/**
 * Optional off-site notify: POST metadata to BACKUP_WEBHOOK_URL after each backup.
 * External systems can then pull via admin download or their own volume access.
 */
export async function notifyBackupWebhook(meta) {
  const url = process.env.BACKUP_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.BACKUP_WEBHOOK_TOKEN
          ? { Authorization: `Bearer ${process.env.BACKUP_WEBHOOK_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        event: "opencode.db.backup",
        ...meta,
        at: new Date().toISOString(),
      }),
    });
  } catch (e) {
    console.warn("[Backup] webhook failed:", e.message);
  }
}

/**
 * Start interval backup (default 24h). Safe no-op if DB missing.
 */
export function startBackupScheduler(
  workdir,
  intervalMs = 24 * 60 * 60 * 1000,
) {
  const run = () => {
    try {
      const r = createDbBackup(workdir);
      console.log(`[Backup] SQLite → ${r.name} (${r.bytes} bytes)`);
      void notifyBackupWebhook({ name: r.name, bytes: r.bytes });
    } catch (e) {
      if (!String(e.message || e).includes("not found")) {
        console.warn("[Backup] skipped:", e.message || e);
      }
    }
  };
  setTimeout(run, 2 * 60 * 1000).unref?.();
  return setInterval(run, intervalMs);
}
