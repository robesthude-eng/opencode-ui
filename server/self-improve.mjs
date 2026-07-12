/**
 * Self-improvement endpoints: rebuild, reset, git operations, instant dist rollback.
 * All operations require self-improve mode to be enabled.
 *
 * SECURITY NOTE: chmod -R a-w is NOT a real security boundary in Docker
 * (root can always override). It's a soft guardrail against accidental
 * writes, not a defense against prompt injection.
 */

import { execFile, promisify } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Live build output served by the proxy
const BUILD_OUT_DIR = "/app/dist";
// Versioned snapshots for instant rollback (symlink switch)
const DIST_VERSIONS_DIR = "/app/dist-versions";
const DIST_CURRENT_LINK = "/app/dist-current";
const MAX_DIST_VERSIONS = 3;

// Concurrency lock: prevents rebuild/reset/rollback from running in parallel.
// Without this, two concurrent operations can race on /app/dist and corrupt it.
let buildInProgress = false;

/**
 * Try to acquire the build lock. Returns true if acquired, false if busy.
 */
export function tryAcquireBuildLock() {
  if (buildInProgress) return false;
  buildInProgress = true;
  return true;
}

/**
 * Release the build lock.
 */
export function releaseBuildLock() {
  buildInProgress = false;
}

/**
 * Get the UI directory path.
 */
export function getUiDir(workdir) {
  const p = path.join(workdir, "opencode-ui");
  if (fs.existsSync(p)) return p;
  if (fs.existsSync(path.join(__dirname, "..", "package.json"))) return path.join(__dirname, "..");
  return p;
}

// ---------------------------------------------------------------------------
// Live source sync for the Self-Improvement agent
// ---------------------------------------------------------------------------
// The agent's workspace (/app/workspace/opencode-ui, on the persistent volume)
// can drift from the real project: the image snapshot (/app/workspace-src) is
// only refreshed at container start, and human pushes after a deploy aren't
// reflected until the next restart. syncUiSource() fixes this by pulling the
// REAL latest from GitHub (origin/main) on demand — e.g. when Self-Improvement
// is toggled ON, or via POST /api/self-improve/resync.

const GITHUB_REPO = process.env.GITHUB_REPO || "https://github.com/robesthude-eng/opencode-ui.git";
// Image snapshot used as a fallback when GitHub is unreachable. Mirrors the
// file list copied by start.sh.
const SRC_SNAPSHOT = "/app/workspace-src";
const ROOT_FILES = [
  "index.html", "package.json", "package-lock.json",
  "tsconfig.json", "tsconfig.node.json", "vite.config.ts",
  "vitest.config.ts", "biome.json", "SELF_IMPROVE.md", "SELF_IMPROVE_GUIDE.md",
];

const execFileP = promisify(execFile);

/**
 * Run a git command inside the UI workspace. Resolves with { ok, stdout, stderr }.
 * When allowFail is true, failures are returned instead of thrown.
 */
async function git(workdir, args, { allowFail = false } = {}) {
  try {
    const { stdout, stderr } = await execFileP("git", args, { cwd: workdir });
    return { ok: true, stdout: (stdout || "").trim(), stderr: (stderr || "").trim() };
  } catch (e) {
    if (allowFail) return { ok: false, error: e.message, stderr: (e.stderr || "").trim() };
    throw e;
  }
}

/**
 * Pull the freshest real source into the agent's workspace.
 *
 * Priority:
 *   1. GitHub `origin/main` — git fetch (+ checkout). Reflects ANY human push,
 *      even after the container started. GITHUB_PAT (if set) is injected per
 *      command via `git -c url…insteadOf` and is NEVER written to .git/config
 *      or any file.
 *   2. Image snapshot /app/workspace-src — used when GitHub is unreachable
 *      (offline, or a private repo without GITHUB_PAT).
 *
 * The agent's in-progress work is checkpointed to the LOCAL git history first,
 * so nothing is ever lost; then the working tree is overlaid with fresh source.
 *
 * @returns {{ source: "github"|"image"|"none", githubOk: boolean }}
 */
export async function syncUiSource(workdir) {
  const uiDir = getUiDir(workdir);
  if (!fs.existsSync(uiDir)) {
    console.warn("[syncUiSource] workspace missing:", uiDir);
    return { source: "none", githubOk: false };
  }

  // 1) Preserve any in-progress agent work in local history (recoverable).
  await git(uiDir, ["add", "-A"]);
  await git(uiDir, ["commit", "-q", "-m", "pre-resync checkpoint", "--allow-empty"], { allowFail: true });

  // 2) Ensure an `origin` remote pointing at the PUBLIC repo URL (no token!).
  const hasOrigin = (await git(uiDir, ["remote", "get-url", "origin"], { allowFail: true })).ok;
  if (!hasOrigin) {
    await git(uiDir, ["remote", "add", "origin", GITHUB_REPO], { allowFail: true });
  }

  // 3) Try to fetch the real latest from GitHub.
  let githubOk = false;
  const pat = process.env.GITHUB_PAT;
  const fetchArgs = pat
    ? ["-c", `url."https://${pat}@github.com/".insteadOf="https://github.com/"`, "fetch", "--depth=1", "origin", "main"]
    : ["fetch", "--depth=1", "origin", "main"];
  const fr = await git(uiDir, fetchArgs, { allowFail: true });
  if (fr.ok) {
    const co = await git(uiDir, ["checkout", "-f", "origin/main", "--", "."], { allowFail: true });
    githubOk = co.ok;
  }

  // 4) Fallback: clean copy from the image snapshot (also drops removed files).
  if (!githubOk && fs.existsSync(SRC_SNAPSHOT)) {
    fs.rmSync(path.join(uiDir, "src"), { recursive: true, force: true });
    fs.cpSync(path.join(SRC_SNAPSHOT, "src"), path.join(uiDir, "src"), { recursive: true });
    if (fs.existsSync(path.join(SRC_SNAPSHOT, "public")))
      fs.cpSync(path.join(SRC_SNAPSHOT, "public"), path.join(uiDir, "public"), { recursive: true });
    for (const f of ROOT_FILES) {
      const s = path.join(SRC_SNAPSHOT, f);
      if (fs.existsSync(s)) fs.copyFileSync(s, path.join(uiDir, f));
    }
  }

  // 5) Record what we synced to.
  const source = githubOk ? "github" : fs.existsSync(SRC_SNAPSHOT) ? "image" : "none";
  const msg = githubOk
    ? "resync → origin/main (GitHub, freshest)"
    : source === "image"
      ? "resync → /app/workspace-src (image fallback)"
      : "resync attempted (no source available)";
  await git(uiDir, ["add", "-A"]);
  await git(uiDir, ["commit", "-q", "-m", msg, "--allow-empty"], { allowFail: true });

  console.log(`[syncUiSource] source=${source} githubOk=${githubOk} dir=${uiDir}`);
  return { source, githubOk };
}

/**
 * Check if self-improve mode is enabled.
 */
export function isSelfImproveEnabled(workdir) {
  const flagFile = path.join(workdir, ".self_improve_mode");
  try {
    return fs.existsSync(flagFile) && fs.readFileSync(flagFile, "utf8").trim() === "true";
  } catch {
    return false;
  }
}

/**
 * Get the id of the dedicated Self-Improvement chat (the one whose agent should
 * operate directly on the live project source). Returns null if not set.
 */
export function getSelfImproveSessionId(workdir) {
  const f = path.join(workdir, ".self_improve_session");
  try {
    if (!fs.existsSync(f)) return null;
    const raw = fs.readFileSync(f, "utf8").trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw).id || null;
    } catch {
      return raw;
    }
  } catch {
    return null;
  }
}

/**
 * Persist the id of the dedicated Self-Improvement chat so the server knows which
 * session's agent should be pointed at /app/workspace/opencode-ui.
 */
export function setSelfImproveSessionId(workdir, id) {
  const f = path.join(workdir, ".self_improve_session");
  try {
    fs.writeFileSync(f, JSON.stringify({ id: id || null }), "utf8");
  } catch (e) {
    console.error("[Self-Improve] failed to store self-improve session id:", e.message);
  }
}

/**
 * Toggle self-improve mode.
 * Flag-only — never chmod. In Docker, chmod -R was freezing the event loop
 * (and is not a real security boundary for root processes anyway).
 * Write access is gated by sandbox allowlist + admin routes, not filesystem mode.
 */
export function toggleSelfImprove(workdir, enabled) {
  const flagFile = path.join(workdir, ".self_improve_mode");
  fs.mkdirSync(workdir, { recursive: true });
  // Always keep the flag file writable for the next toggle
  try {
    fs.chmodSync(flagFile, 0o644);
  } catch {
    /* may not exist yet */
  }
  fs.writeFileSync(flagFile, String(!!enabled), "utf8");
  try {
    fs.chmodSync(flagFile, 0o644);
  } catch {
    /* ignore */
  }
  console.log(
    enabled
      ? "[Self-Improvement] ENABLED (flag only, no chmod)"
      : "[Self-Improvement] DISABLED (flag only, no chmod)",
  );
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
      .map((n) => ({ name: n, mtime: fs.statSync(path.join(DIST_VERSIONS_DIR, n)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const old of entries.slice(MAX_DIST_VERSIONS)) {
      try {
        fs.rmSync(path.join(DIST_VERSIONS_DIR, old.name), { recursive: true, force: true });
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
    const entries = fs
      .readdirSync(DIST_VERSIONS_DIR)
      .filter((n) => n.startsWith("v-"))
      .map((n) => ({ name: n, mtime: fs.statSync(path.join(DIST_VERSIONS_DIR, n)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    // index 0 = second newest (previous), because [0] is current after promote
    const target = entries[index + 1] || entries[index];
    if (!target) throw new Error("No older dist snapshot to roll back to");
    if (entries.length < 2 && index === 0) {
      throw new Error("Only one snapshot exists — nothing to roll back to");
    }
    const versionDir = path.join(DIST_VERSIONS_DIR, target.name);
    // Atomic swap: copy to temp dir, then rename over /app/dist
    const tempDir = `${BUILD_OUT_DIR}.rollback-tmp`;
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.cpSync(versionDir, tempDir, { recursive: true });
    // Rename is atomic on the same filesystem
    fs.rmSync(BUILD_OUT_DIR, { recursive: true, force: true });
    fs.renameSync(tempDir, BUILD_OUT_DIR);
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

export function listDistSnapshots() {
  try {
    if (!fs.existsSync(DIST_VERSIONS_DIR)) return [];
    return fs
      .readdirSync(DIST_VERSIONS_DIR)
      .filter((n) => n.startsWith("v-"))
      .map((n) => {
        const p = path.join(DIST_VERSIONS_DIR, n);
        const st = fs.statSync(p);
        return { name: n, mtime: st.mtimeMs, time: st.mtime.toISOString() };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
}

/**
 * Run npm install + vite build using execFile (no shell interpolation).
 * All arguments are hardcoded constants — no user input reaches the command.
 */
function runBuild(cwd, callback) {
  // Railway trial has 512MB RAM. vite build of 2656 modules needs ~800MB
  // and gets OOM-killed. We try a minimal config (no PWA/react-compiler)
  // to reduce memory. If it still fails, we return an error and keep the
  // existing Docker-built dist intact — the user should git push for a
  // proper rebuild (Railway's Docker builder has more RAM).
  // DO NOT fall back to esbuild — its ESM output loads but React never
  // mounts (blank page), which is worse than keeping the old dist.
  const env = { ...process.env, NODE_OPTIONS: "--max-old-space-size=4096" };
  execFile("npm", ["install", "--silent"], { cwd, timeout: 120000, env }, (err1, stdout1, stderr1) => {
    if (err1) {
      return callback(new Error(`npm install failed: ${stderr1 || err1.message}`));
    }
    // Create a minimal vite config (no PWA, no react-compiler) to save memory
    const minimalConfig = `
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  build: {
    outDir: "${BUILD_OUT_DIR.replace(/\\/g, "/")}",
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        entryFileNames: "assets/index-rebuilt-[hash].js",
        chunkFileNames: "assets/chunk-[hash].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
`;
    const configPath = path.join(cwd, "vite.rebuild.config.ts");
    fs.writeFileSync(configPath, minimalConfig);

    execFile(
      "npx",
      ["vite", "build", "--config", configPath],
      { cwd, timeout: 300000, env, maxBuffer: 20 * 1024 * 1024 },
      (err2, stdout2, stderr2) => {
        // Clean up temp config
        try { fs.unlinkSync(configPath); } catch {}

        if (err2) {
          // Vite failed (likely OOM). Return error — do NOT fall back to
          // esbuild (its ESM output produces a blank page).
          const isOOM = (stderr2 || "").includes("Killed") || err2.message.includes("Killed");
          return callback(new Error(
            isOOM
              ? `vite build was killed (OOM). Railway trial (512MB RAM) cannot build ${"2656"} modules. Push to git for a Docker rebuild (Railway builder has more RAM), or upgrade to a paid plan.`
              : `vite build failed: ${stderr2 || err2.message}`
          ));
        }

        // Vite succeeded — update index.html to reference the new bundle
        const indexHtml = path.join(BUILD_OUT_DIR, "index.html");
        if (fs.existsSync(indexHtml)) {
          let html = fs.readFileSync(indexHtml, "utf8");
          const stamp = Date.now();
          // Replace the old script tag with one pointing to the new bundle
          html = html.replace(
            /<script[^>]*src="\/assets\/index-[^"]*\.js"[^>]*><\/script>/,
            `<script type="module" crossorigin src="/assets/index-rebuilt-${stamp}.js"></script>`,
          );
          // Find the actual generated JS filename and update the reference
          // Sort by mtime descending to get the LATEST build, not a stale one
          const assetsDir = path.join(BUILD_OUT_DIR, "assets");
          if (fs.existsSync(assetsDir)) {
            const newJs = fs.readdirSync(assetsDir)
              .filter(f => f.startsWith("index-rebuilt-") && f.endsWith(".js"))
              .map(f => ({ f, m: fs.statSync(path.join(assetsDir, f)).mtimeMs }))
              .sort((a, b) => b.m - a.m)[0]?.f;
            if (newJs) {
              html = html.replace(
                /<script[^>]*src="\/assets\/index-rebuilt-[^"]*\.js"[^>]*><\/script>/,
                `<script type="module" crossorigin src="/assets/${newJs}"></script>`,
              );
            }
          }
          // Remove PWA SW registration to prevent stale cache
          html = html.replace(
            /<script[^>]*id="vite-plugin-pwa:register-sw"[^>]*><\/script>/,
            "",
          );
          fs.writeFileSync(indexHtml, html);
        }
        promoteDistSnapshot();
        callback(null, `${stdout1 || ""}\n${stdout2 || ""}`);
      },
    );
  });
}

/**
 * Rebuild the UI (npm install + vite build).
 */
export function rebuildUi(workdir, callback) {
  const uiDir = getUiDir(workdir);
  if (!fs.existsSync(uiDir)) {
    return callback(new Error("Directory opencode-ui not found in workspace."));
  }
  console.log("[Rebuild] Starting rebuild...");
  runBuild(uiDir, (err, stdout) => {
    if (err) {
      console.error("[Rebuild] Failed:", err.message);
      callback(err);
    } else {
      console.log("[Rebuild] Successfully rebuilt UI!");
      callback(null, stdout);
    }
  });
}

/**
 * Reset UI to factory version and rebuild.
 */
export function resetUi(workdir, callback) {
  const uiDir = getUiDir(workdir);
  const srcDir = "/app/workspace-src";

  if (!fs.existsSync(srcDir)) {
    return callback(new Error("Factory source directory /app/workspace-src not found."));
  }

  execFile("mkdir", ["-p", path.join(uiDir, "src")], { timeout: 10000 }, (err1) => {
    if (err1) return callback(err1);

    execFile(
      "cp",
      ["-rf", `${path.join(srcDir, "src")}/.`, `${path.join(uiDir, "src")}/`],
      { timeout: 30000 },
      (err2) => {
        if (err2) return callback(err2);

        const filesToCopy = [
          [path.join(srcDir, "index.html"), path.join(uiDir, "index.html")],
          [path.join(srcDir, "package.json"), path.join(uiDir, "package.json")],
          [path.join(srcDir, "vite.config.ts"), path.join(uiDir, "vite.config.ts")],
          [path.join(srcDir, "tsconfig.json"), path.join(uiDir, "tsconfig.json")],
          [path.join(srcDir, "tsconfig.node.json"), path.join(uiDir, "tsconfig.node.json")],
        ];

        for (const [src, dest] of filesToCopy) {
          try {
            fs.copyFileSync(src, dest);
          } catch (e) {
            console.warn(`[Reset UI] Could not copy ${src}: ${e.message}`);
          }
        }

        console.log("[Reset UI] Copied factory files, rebuilding...");
        runBuild(uiDir, (err, stdout) => {
          if (err) {
            console.error("[Reset UI] Failed:", err.message);
            callback(err);
          } else {
            console.log("[Reset UI] Successfully reset and rebuilt UI!");
            callback(null, stdout);
          }
        });
      },
    );
  });
}

/**
 * Create a git checkpoint.
 */
export function createCheckpoint(workdir, callback) {
  const uiDir = getUiDir(workdir);
  if (!fs.existsSync(uiDir)) {
    return callback(new Error("Directory opencode-ui not found."));
  }

  execFile("git", ["status", "--porcelain"], { cwd: uiDir, timeout: 10000 }, (_err, statusOut) => {
    if (!statusOut?.trim()) {
      execFile(
        "git",
        ["log", "-1", "--format=%h — %s (%cr)"],
        { cwd: uiDir, timeout: 10000 },
        (_err2, logOut) => {
          callback(null, {
            status: "noop",
            message: "No changes to save",
            commit: logOut?.trim() || "",
          });
        },
      );
      return;
    }

    const now = new Date();
    const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    const msg = `Checkpoint: ${timeStr} (by UI)`;

    execFile("git", ["add", "."], { cwd: uiDir, timeout: 10000 }, (err1) => {
      if (err1) return callback(new Error("git add failed"));

      execFile("git", ["commit", "-m", msg], { cwd: uiDir, timeout: 15000 }, (err2) => {
        if (err2) {
          console.error("[Checkpoint] Failed:", err2.message);
          callback(err2);
        } else {
          execFile(
            "git",
            ["log", "-1", "--format=%h — %s (%cr)"],
            { cwd: uiDir, timeout: 10000 },
            (_err3, commitOut) => {
              console.log(`[Checkpoint] Created: ${commitOut?.trim()}`);
              callback(null, {
                status: "success",
                message: "Checkpoint created!",
                commit: commitOut?.trim() || "",
              });
            },
          );
        }
      });
    });
  });
}

/**
 * List git checkpoints.
 */
export function listCheckpoints(workdir, callback) {
  const uiDir = getUiDir(workdir);
  if (!fs.existsSync(uiDir)) {
    return callback(null, []);
  }
  // If .git doesn't exist, return empty list instead of failing — start.sh
  // initializes it on next boot, but we shouldn't 500 in the meantime.
  if (!fs.existsSync(path.join(uiDir, ".git"))) {
    return callback(null, []);
  }

  execFile(
    "git",
    ["log", "-n", "15", "--format=%h|%s|%cr"],
    { cwd: uiDir, timeout: 10000 },
    (err, stdout) => {
      if (err) return callback(null, []);

      const commits = (stdout || "")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const parts = line.split("|");
          return { hash: parts[0] || "", subject: parts[1] || "", time: parts[2] || "" };
        });

      callback(null, commits);
    },
  );
}

/**
 * Rollback to a specific commit and rebuild.
 * hash is validated by caller (regex /^[a-fA-F0-9]{4,40}$/) — safe for execFile.
 */
export function rollbackToCommit(workdir, hash, callback) {
  const uiDir = getUiDir(workdir);

  execFile("git", ["reset", "--hard", hash], { cwd: uiDir, timeout: 30000 }, (err1) => {
    if (err1) {
      console.error("[Rollback] git reset failed:", err1.message);
      return callback(err1);
    }

    execFile("git", ["clean", "-fd"], { cwd: uiDir, timeout: 30000 }, (err2) => {
      if (err2) {
        console.error("[Rollback] git clean failed:", err2.message);
        return callback(err2);
      }

      console.log(`[Rollback] Rolled back to ${hash}, rebuilding...`);
      runBuild(uiDir, (err, _stdout) => {
        if (err) {
          console.error("[Rollback] Build failed:", err.message);
          callback(err);
        } else {
          console.log(`[Rollback] Successfully rolled back to ${hash}!`);
          callback(null, { message: `Rolled back to ${hash}` });
        }
      });
    });
  });
}

/**
 * Write audit log for administrative actions.
 * Format: JSON Lines (one JSON object per line) for easy parsing.
 * Rotation: when audit.log exceeds 1MB, rename to audit.log.1 and start fresh.
 * Keeps at most 1 rotated file (2MB total max).
 */
const AUDIT_MAX_BYTES = 1024 * 1024; // 1MB
const AUDIT_MAX_FILES = 1; // keep audit.log + audit.log.1

export function logAudit(workdir, userEmail, action, details = "") {
  try {
    const logFile = path.join(workdir, "audit.log");
    const now = new Date().toISOString();
    const entry = {
      timestamp: now,
      user: userEmail || "anonymous/unknown",
      action,
      details: details || undefined,
    };
    const line = JSON.stringify(entry) + "\n";
    fs.appendFileSync(logFile, line, "utf8");

    // Rotate if file exceeds max size
    try {
      const stats = fs.statSync(logFile);
      if (stats.size > AUDIT_MAX_BYTES) {
        const rotatedFile = `${logFile}.1`;
        // Remove old rotated file if exists
        try { fs.unlinkSync(rotatedFile); } catch { /* ignore */ }
        fs.renameSync(logFile, rotatedFile);
      }
    } catch {
      /* rotation is best-effort */
    }

    console.log(`[Audit] [${now}] [${entry.user}] [${action}] ${details}`);
  } catch (e) {
    console.error("[Audit] Failed to write audit log:", e.message);
  }
}

/**
 * Read audit log entries (most recent first).
 * Returns array of parsed JSON objects, or legacy text lines for old entries.
 */
export function readAuditLog(workdir, maxEntries = 100) {
  try {
    const logFile = path.join(workdir, "audit.log");
    const rotatedFile = `${logFile}.1`;
    const entries = [];

    // Read rotated file first (older entries)
    for (const file of [rotatedFile, logFile]) {
      if (!fs.existsSync(file)) continue;
      const content = fs.readFileSync(file, "utf8");
      const lines = content.trim().split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          entries.push(parsed);
        } catch {
          // Legacy plain-text format — wrap in object
          entries.push({ raw: line, timestamp: "", user: "", action: "", details: "" });
        }
      }
    }

    // Sort by timestamp descending (most recent first), take last maxEntries
    entries.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
    return entries.slice(0, maxEntries);
  } catch {
    return [];
  }
}
