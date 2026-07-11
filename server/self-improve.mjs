/**
 * Self-improvement endpoints: rebuild, reset, git operations, instant dist rollback.
 * All operations require self-improve mode to be enabled.
 *
 * SECURITY NOTE: chmod -R a-w is NOT a real security boundary in Docker
 * (root can always override). It's a soft guardrail against accidental
 * writes, not a defense against prompt injection.
 */

import { execFile } from "node:child_process";
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

/**
 * Get the UI directory path.
 */
export function getUiDir(workdir) {
  const p = path.join(workdir, "opencode-ui");
  if (fs.existsSync(p)) return p;
  if (fs.existsSync(path.join(__dirname, "..", "package.json"))) return path.join(__dirname, "..");
  return p;
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
    const versionDir = path.join(DIST_VERSIONS_DIR, target.name);
    // Replace live dist
    fs.rmSync(BUILD_OUT_DIR, { recursive: true, force: true });
    fs.cpSync(versionDir, BUILD_OUT_DIR, { recursive: true });
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
  // Railway trial has 512MB RAM. vite production build of 2656 modules needs
  // ~800MB and gets OOM-killed even in dev mode.
  // Strategy: try vite first; if it fails (OOM), fall back to esbuild which
  // uses ~50MB. esbuild doesn't handle Tailwind CSS or PWA, so we keep the
  // existing CSS from the last Docker build and only replace the JS bundle.
  // IMPORTANT: do NOT use --emptyOutDir with vite — if vite OOMs after
  // clearing /app/dist, the esbuild fallback has no CSS/index.html to preserve.
  const env = { ...process.env, NODE_OPTIONS: "--max-old-space-size=4096" };
  execFile("npm", ["install", "--silent"], { cwd, timeout: 120000, env }, (err1, stdout1, stderr1) => {
    if (err1) {
      return callback(new Error(`npm install failed: ${stderr1 || err1.message}`));
    }
    // Try vite build first (full pipeline: Tailwind + PWA + React)
    // No --emptyOutDir: if vite fails, /app/dist still has the previous build
    execFile(
      "npx",
      ["vite", "build", "--mode", "development", "--outDir", BUILD_OUT_DIR, "--minify", "false", "--sourcemap", "false"],
      { cwd, timeout: 120000, env, maxBuffer: 20 * 1024 * 1024 },
      (err2, stdout2, stderr2) => {
        if (!err2) {
          promoteDistSnapshot();
          callback(null, `${stdout1 || ""}\n${stdout2 || ""}`);
          return;
        }
        // Vite failed (likely OOM) — fall back to esbuild
        console.warn("[Rebuild] vite build failed, falling back to esbuild:", stderr2 || err2.message);
        runEsbuildFallback(cwd, (err3, stdout3) => {
          if (err3) {
            return callback(new Error(`Both vite and esbuild failed. vite: ${stderr2 || err2.message} | esbuild: ${err3.message}`));
          }
          promoteDistSnapshot();
          callback(null, `${stdout1 || ""}\n[esbuild fallback]\n${stdout3 || ""}`);
        });
      },
    );
  });
}

/**
 * Fallback build using esbuild directly. Much lower memory (~50MB vs 800MB
 * for vite). Only rebuilds the JS bundle; keeps existing CSS from the last
 * Docker-built /app/dist. Handles .tsx, .ts, .css imports, and JSX automatic
 * runtime. Does NOT handle Tailwind processing or PWA service worker — those
 * remain from the previous build.
 */
function runEsbuildFallback(cwd, callback) {
  const entryPoint = path.join(cwd, "src", "main.tsx");
  if (!fs.existsSync(entryPoint)) {
    return callback(new Error("src/main.tsx not found"));
  }
  // Find existing CSS file in /app/dist/assets to preserve
  const assetsDir = path.join(BUILD_OUT_DIR, "assets");
  let existingCss = null;
  if (fs.existsSync(assetsDir)) {
    const files = fs.readdirSync(assetsDir);
    existingCss = files.find((f) => f.endsWith(".css"));
  }

  const outFile = path.join(assetsDir, "index-esbuild.js");
  fs.mkdirSync(assetsDir, { recursive: true });

  const args = [
    entryPoint,
    "--bundle",
    `--outfile=${outFile}`,
    "--alias:@=./src",
    "--loader:.tsx=tsx",
    "--loader:.ts=ts",
    "--loader:.css=empty",
    "--loader:.png=file",
    "--loader:.jpg=file",
    "--loader:.svg=file",
    "--loader:.woff=file",
    "--loader:.woff2=file",
    "--jsx=automatic",
    '--define:process.env.NODE_ENV="production"',
    "--format=iife",
    "--global-name=OpenCodeUI",
    "--log-level=info",
  ];

  execFile("npx", ["esbuild", ...args], { cwd, timeout: 120000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) {
      return callback(new Error(`esbuild failed: ${stderr || err.message}`));
    }
    // Update index.html to reference the new JS bundle
    const indexHtml = path.join(BUILD_OUT_DIR, "index.html");
    if (fs.existsSync(indexHtml)) {
      let html = fs.readFileSync(indexHtml, "utf8");
      // Replace any script src that points to assets/index-*.js with our new bundle
      html = html.replace(
        /<script[^>]*src="\/assets\/index-[^"]*\.js"[^>]*><\/script>/,
        `<script src="/assets/index-esbuild.js"></script>`,
      );
      fs.writeFileSync(indexHtml, html);
    } else {
      // Create minimal index.html
      fs.writeFileSync(
        indexHtml,
        `<!DOCTYPE html><html><head><meta charset="UTF-8">${existingCss ? `<link rel="stylesheet" href="/assets/${existingCss}">` : ""}</head><body><div id="root"></div><script type="module" src="/assets/index-esbuild.js"></script></body></html>`,
      );
    }
    callback(null, stdout + (existingCss ? `\n[preserved CSS: ${existingCss}]` : ""));
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
 */
export function logAudit(workdir, userEmail, action, details = "") {
  try {
    const logFile = path.join(workdir, "audit.log");
    const now = new Date().toISOString();
    const line = `[${now}] [User: ${userEmail || "anonymous/unknown"}] [Action: ${action}] ${details}\n`;
    fs.appendFileSync(logFile, line, "utf8");
    console.log(`[Audit] ${line.trim()}`);
  } catch (e) {
    console.error("[Audit] Failed to write audit log:", e.message);
  }
}
