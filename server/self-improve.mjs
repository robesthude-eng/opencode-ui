/**
 * Self-improvement endpoints: rebuild, reset, git operations.
 * All operations require self-improve mode to be enabled.
 *
 * SECURITY NOTE: chmod -R a-w is NOT a real security boundary in Docker
 * (root can always override). It's a soft guardrail against accidental
 * writes, not a defense against prompt injection.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Hardcoded build output — never derived from user input
const BUILD_OUT_DIR = "/app/dist";

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
 */
export function toggleSelfImprove(workdir, enabled) {
  const flagFile = path.join(workdir, ".self_improve_mode");
  fs.mkdirSync(workdir, { recursive: true });
  fs.writeFileSync(flagFile, String(!!enabled), "utf8");

  const uiDir = getUiDir(workdir);
  if (enabled) {
    execFile("chmod", ["-R", "u+w", uiDir], { timeout: 10000 }, () => {});
    console.log("[Self-Improvement] ENABLED (write permissions restored)");
  } else {
    execFile("chmod", ["-R", "a-w", uiDir], { timeout: 10000 }, () => {});
    console.log("[Self-Improvement] DISABLED (read-only permissions)");
  }
}

/**
 * Run npm install + vite build using execFile (no shell interpolation).
 * All arguments are hardcoded constants — no user input reaches the command.
 */
function runBuild(cwd, callback) {
  // Step 1: npm install
  execFile("npm", ["install", "--silent"], { cwd, timeout: 60000 }, (err1, stdout1, stderr1) => {
    if (err1) {
      return callback(new Error(`npm install failed: ${stderr1 || err1.message}`));
    }
    // Step 2: npx vite build
    execFile("npx", ["vite", "build", "--outDir", BUILD_OUT_DIR], { cwd, timeout: 60000 }, (err2, stdout2, stderr2) => {
      if (err2) {
        return callback(new Error(`vite build failed: ${stderr2 || err2.message}`));
      }
      callback(null, (stdout1 || "") + "\n" + (stdout2 || ""));
    });
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

  // Step 1: mkdir -p src
  execFile("mkdir", ["-p", path.join(uiDir, "src")], { timeout: 10000 }, (err1) => {
    if (err1) return callback(err1);

    // Step 2: Copy src directory
    execFile("cp", ["-rf", path.join(srcDir, "src") + "/.", path.join(uiDir, "src") + "/"], { timeout: 30000 }, (err2) => {
      if (err2) return callback(err2);

      // Step 3: Copy individual config files (safe — all paths are constants)
      const filesToCopy = [
        [path.join(srcDir, "index.html"), path.join(uiDir, "index.html")],
        [path.join(srcDir, "package.json"), path.join(uiDir, "package.json")],
        [path.join(srcDir, "vite.config.ts"), path.join(uiDir, "vite.config.ts")],
        [path.join(srcDir, "tsconfig.json"), path.join(uiDir, "tsconfig.json")],
        [path.join(srcDir, "tsconfig.node.json"), path.join(uiDir, "tsconfig.node.json")],
      ];

      for (const [src, dest] of filesToCopy) {
        try { fs.copyFileSync(src, dest); } catch (e) {
          console.warn(`[Reset UI] Could not copy ${src}: ${e.message}`);
        }
      }

      // Step 4: Build
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
    });
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

  execFile("git", ["status", "--porcelain"], { cwd: uiDir, timeout: 10000 }, (err, statusOut) => {
    if (!statusOut || !statusOut.trim()) {
      execFile("git", ["log", "-1", "--format=%h — %s (%cr)"], { cwd: uiDir, timeout: 10000 }, (err2, logOut) => {
        callback(null, { status: "noop", message: "No changes to save", commit: logOut?.trim() || "" });
      });
      return;
    }

    const now = new Date();
    const timeStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
    const msg = `Checkpoint: ${timeStr} (by UI)`;

    execFile("git", ["add", "."], { cwd: uiDir, timeout: 10000 }, (err1) => {
      if (err1) return callback(new Error("git add failed"));

      execFile("git", ["commit", "-m", msg], { cwd: uiDir, timeout: 15000 }, (err2) => {
        if (err2) {
          console.error("[Checkpoint] Failed:", err2.message);
          callback(err2);
        } else {
          execFile("git", ["log", "-1", "--format=%h — %s (%cr)"], { cwd: uiDir, timeout: 10000 }, (err3, commitOut) => {
            console.log(`[Checkpoint] Created: ${commitOut?.trim()}`);
            callback(null, { status: "success", message: "Checkpoint created!", commit: commitOut?.trim() || "" });
          });
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

  execFile("git", ["log", "-n", "15", "--format=%h|%s|%cr"], { cwd: uiDir, timeout: 10000 }, (err, stdout) => {
    if (err) return callback(err);

    const commits = (stdout || "").trim().split("\n").filter(Boolean).map(line => {
      const parts = line.split("|");
      return { hash: parts[0] || "", subject: parts[1] || "", time: parts[2] || "" };
    });

    callback(null, commits);
  });
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
      runBuild(uiDir, (err, stdout) => {
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
