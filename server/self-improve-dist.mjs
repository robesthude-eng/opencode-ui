/**
 * Релиз 5 (Пакет 3): dist-снапшоты и мгновенный откат вынесены из self-improve.mjs
 * без изменений логики (атомарная подмена /app/dist, симлинк dist-current, прунинг).
 */
import fs from "node:fs";
import path from "node:path";

// Live build output served by the proxy
export const BUILD_OUT_DIR = "/app/dist";
// Versioned snapshots for instant rollback (symlink switch)
const DIST_VERSIONS_DIR = "/app/dist-versions";
const DIST_CURRENT_LINK = "/app/dist-current";
const MAX_DIST_VERSIONS =
  Number(process.env.SELF_IMPROVE_MAX_DIST_VERSIONS) || 3;

function distEntries() {
  if (!fs.existsSync(DIST_VERSIONS_DIR)) return [];
  const current = (() => {
    try {
      return path.basename(fs.readlinkSync(DIST_CURRENT_LINK));
    } catch {
      return null;
    }
  })();
  return fs
    .readdirSync(DIST_VERSIONS_DIR)
    .filter((n) => n.startsWith("v-"))
    .map((name) => {
      const p = path.join(DIST_VERSIONS_DIR, name);
      return { name, mtime: fs.statSync(p).mtimeMs, current: name === current };
    })
    .sort((a, b) => Number(b.current) - Number(a.current) || b.mtime - a.mtime);
}

/**
 * After a successful vite build into BUILD_OUT_DIR, snapshot it into
 * /app/dist-versions/vN and flip /app/dist-current → that snapshot.
 * Keeps last MAX_DIST_VERSIONS for instant rollback without rebuild.
 */
export function promoteDistSnapshot() {
  try {
    if (!fs.existsSync(BUILD_OUT_DIR)) {
      console.warn("[Dist] No /app/dist to snapshot");
      return null;
    }
    fs.mkdirSync(DIST_VERSIONS_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const versionDir = path.join(DIST_VERSIONS_DIR, `v-${stamp}`);
    // Copy dist → version dir (cp -a preserves)
    fs.cpSync(BUILD_OUT_DIR, versionDir, { recursive: true });

    // Atomic-ish symlink flip: link tmp → rename over dist-current
    const tmpLink = `${DIST_CURRENT_LINK}.tmp`;
    try {
      fs.unlinkSync(tmpLink);
    } catch {
      /* ignore */
    }
    fs.symlinkSync(versionDir, tmpLink);
    fs.renameSync(tmpLink, DIST_CURRENT_LINK);

    // Also keep /app/dist in sync (server serves DIST path)
    // Already built there; nothing else needed.

    // Prune old versions
    const entries = fs
      .readdirSync(DIST_VERSIONS_DIR)
      .filter((n) => n.startsWith("v-"))
      .map((n) => ({
        name: n,
        mtime: fs.statSync(path.join(DIST_VERSIONS_DIR, n)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const old of entries.slice(MAX_DIST_VERSIONS)) {
      try {
        fs.rmSync(path.join(DIST_VERSIONS_DIR, old.name), {
          recursive: true,
          force: true,
        });
      } catch (e) {
        console.warn("[Dist] prune failed:", e.message);
      }
    }
    console.log(`[Dist] Snapshot promoted: ${versionDir}`);
    return versionDir;
  } catch (e) {
    console.error("[Dist] promoteDistSnapshot failed:", e.message);
    return null;
  }
}

function replaceLiveDistFrom(versionDir, label) {
  const tempDir = `${BUILD_OUT_DIR}.${label}-tmp`;
  const oldDir = `${BUILD_OUT_DIR}.${label}-old-${process.pid}-${Date.now()}`;
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.cpSync(versionDir, tempDir, { recursive: true });
  let movedOld = false;
  try {
    if (fs.existsSync(BUILD_OUT_DIR)) {
      fs.renameSync(BUILD_OUT_DIR, oldDir);
      movedOld = true;
    }
    fs.renameSync(tempDir, BUILD_OUT_DIR);
    if (movedOld) fs.rmSync(oldDir, { recursive: true, force: true });
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (movedOld && !fs.existsSync(BUILD_OUT_DIR))
      fs.renameSync(oldDir, BUILD_OUT_DIR);
    throw error;
  }
}

/**
 * Instant rollback: restore /app/dist from a previous snapshot (no rebuild).
 * index: 0 = previous, 1 = older, …
 *
 * ATOMICITY: Instead of rm + cp (which leaves /app/dist empty for 1-3s
 * during the copy, causing 404s for concurrent requests), we build to a
 * temp dir and rename atomically.
 */
export function instantRollbackDist(index = 0) {
  try {
    if (!fs.existsSync(DIST_VERSIONS_DIR)) {
      throw new Error("No dist snapshots available");
    }
    const entries = distEntries();
    // entries[0] is the version selected by dist-current; index 0 means the next older version.
    const target = entries[index + 1];
    if (!target) throw new Error("No older dist snapshot to roll back to");
    if (entries.length < 2 && index === 0) {
      throw new Error("Only one snapshot exists — nothing to roll back to");
    }
    const versionDir = path.join(DIST_VERSIONS_DIR, target.name);
    replaceLiveDistFrom(versionDir, "rollback");
    try {
      fs.unlinkSync(DIST_CURRENT_LINK);
    } catch {
      /* ignore */
    }
    fs.symlinkSync(versionDir, DIST_CURRENT_LINK);
    console.log(`[Dist] Instant rollback to ${target.name}`);
    return { version: target.name, path: versionDir };
  } catch (e) {
    console.error("[Dist] instantRollbackDist failed:", e.message);
    throw e;
  }
}

/**
 * Restore /app/dist from the NEWEST snapshot (the last successfully published
 * version). Unlike instantRollbackDist(0) — which targets the *previous*
 * snapshot because it assumes /app/dist === entries[0] — this is for the
 * failure path of a self-improve transaction: a broken build has overwritten
 * /app/dist but was never promoted, so entries[0] is still the last good
 * publish and is exactly what must come back.
 */
export function restoreLatestDist() {
  try {
    if (!fs.existsSync(DIST_VERSIONS_DIR)) {
      throw new Error("No dist snapshots available");
    }
    const entries = distEntries();
    const target = entries.find((entry) => entry.current) || entries[0];
    if (!target) throw new Error("No dist snapshot to restore");
    const versionDir = path.join(DIST_VERSIONS_DIR, target.name);
    replaceLiveDistFrom(versionDir, "restore");
    try {
      fs.unlinkSync(DIST_CURRENT_LINK);
    } catch {
      /* ignore */
    }
    fs.symlinkSync(versionDir, DIST_CURRENT_LINK);
    console.log(`[Dist] Restored last published snapshot ${target.name}`);
    return { version: target.name, path: versionDir };
  } catch (e) {
    console.error("[Dist] restoreLatestDist failed:", e.message);
    throw e;
  }
}

export function listDistSnapshots() {
  try {
    if (!fs.existsSync(DIST_VERSIONS_DIR)) return [];
    return distEntries().map((entry) => ({
      name: entry.name,
      mtime: entry.mtime,
      time: new Date(entry.mtime).toISOString(),
      current: entry.current,
    }));
  } catch {
    return [];
  }
}
