/**
 * Self-improvement endpoints: rebuild, reset, git operations, instant dist rollback.
 * All operations require self-improve mode to be enabled.
 *
 * SECURITY NOTE: chmod -R a-w is NOT a real security boundary in Docker
 * (root can always override). It's a soft guardrail against accidental
 * writes, not a defense against prompt injection.
 */

import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { BUILD_OUT_DIR } from "./self-improve-dist.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GIT_COMMAND_TIMEOUT_MS =
  Number(process.env.SELF_IMPROVE_GIT_TIMEOUT_MS) || 30_000;
const REBUILD_NPM_TIMEOUT_MS =
  Number(process.env.SELF_IMPROVE_NPM_TIMEOUT_MS) || 300_000;
const REBUILD_VITE_TIMEOUT_MS =
  Number(process.env.SELF_IMPROVE_VITE_TIMEOUT_MS) || 600_000;
const INTERNAL_TOKEN_FILE = ".si-internal-token";

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
  if (fs.existsSync(path.join(__dirname, "..", "package.json")))
    return path.join(__dirname, "..");
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

const GITHUB_REPO =
  process.env.GITHUB_REPO ||
  "https://github.com/robesthude-eng/opencode-ui.git";
// Image snapshot used as a fallback when GitHub is unreachable. Mirrors the
// file list copied by start.sh.
const SRC_SNAPSHOT = "/app/workspace-src";
const ROOT_FILES = [
  "index.html",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.node.json",
  "vite.config.ts",
  "vitest.config.ts",
  "biome.json",
  "SELF_IMPROVE.md",
  "SELF_IMPROVE_GUIDE.md",
];

const execFileP = promisify(execFile);

/**
 * Run a git command inside the UI workspace. Resolves with { ok, stdout, stderr }.
 * When allowFail is true, failures are returned instead of thrown.
 */
async function git(workdir, args, { allowFail = false, env = null } = {}) {
  try {
    const { stdout, stderr } = await execFileP("git", args, {
      cwd: workdir,
      timeout: GIT_COMMAND_TIMEOUT_MS,
      // Секреты (PAT) передаются через окружение, а не argv:
      // аргументы процесса видны любому через /proc/<pid>/cmdline.
      ...(env ? { env: { ...process.env, ...env } } : {}),
    });
    return {
      ok: true,
      stdout: (stdout || "").trim(),
      stderr: (stderr || "").trim(),
    };
  } catch (e) {
    if (allowFail)
      return { ok: false, error: e.message, stderr: (e.stderr || "").trim() };
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
  await new Promise((res) =>
    commitBounded(uiDir, "pre-resync checkpoint", () => res()),
  );

  // 2) Ensure an `origin` remote pointing at the PUBLIC repo URL (no token!).
  const originInfo = await git(uiDir, ["remote", "get-url", "origin"], {
    allowFail: true,
  });
  if (!originInfo.ok) {
    await git(uiDir, ["remote", "add", "origin", GITHUB_REPO], {
      allowFail: true,
    });
  } else if (originInfo.stdout !== GITHUB_REPO) {
    // Normalize any legacy token-bearing remote before future commands.
    await git(uiDir, ["remote", "set-url", "origin", GITHUB_REPO], {
      allowFail: true,
    });
  }

  // 3) Try to fetch the real latest from GitHub.
  let githubOk = false;
  const pat = process.env.GITHUB_PAT;
  // Токен уходит в git через GIT_CONFIG_* переменные окружения, а не через
  // argv `-c` (аргументы видны всем процессам через /proc/<pid>/cmdline).
  const fetchEnv = pat
    ? {
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: `url.https://${pat}@github.com/.insteadOf`,
        GIT_CONFIG_VALUE_0: "https://github.com/",
      }
    : null;
  const fr = await git(uiDir, ["fetch", "--depth=1", "origin", "main"], {
    allowFail: true,
    env: fetchEnv,
  });
  if (fr.ok) {
    const co = await git(uiDir, ["checkout", "-f", "origin/main", "--", "."], {
      allowFail: true,
    });
    githubOk = co.ok;
  }

  // 4) Fallback: clean copy from the image snapshot (also drops removed files).
  if (!githubOk && fs.existsSync(SRC_SNAPSHOT)) {
    fs.rmSync(path.join(uiDir, "src"), { recursive: true, force: true });
    fs.cpSync(path.join(SRC_SNAPSHOT, "src"), path.join(uiDir, "src"), {
      recursive: true,
    });
    if (fs.existsSync(path.join(SRC_SNAPSHOT, "public")))
      fs.cpSync(path.join(SRC_SNAPSHOT, "public"), path.join(uiDir, "public"), {
        recursive: true,
      });
    for (const f of ROOT_FILES) {
      const s = path.join(SRC_SNAPSHOT, f);
      if (fs.existsSync(s)) fs.copyFileSync(s, path.join(uiDir, f));
    }
  }

  // 5) Record what we synced to.
  const source = githubOk
    ? "github"
    : fs.existsSync(SRC_SNAPSHOT)
      ? "image"
      : "none";
  const msg = githubOk
    ? "resync → origin/main (GitHub, freshest)"
    : source === "image"
      ? "resync → /app/workspace-src (image fallback)"
      : "resync attempted (no source available)";
  await git(uiDir, ["add", "-A"]);
  await new Promise((res) => commitBounded(uiDir, msg, () => res()));

  // An explicit resync is the point at which it is safe to refresh the
  // dedicated agent snapshot as well; otherwise it would read stale source.
  const siSessionId = getSelfImproveSessionId(workdir);
  if (siSessionId) refreshSelfImproveWorkspace(workdir, siSessionId);

  // Keep the local history bounded (compact unreachable objects).
  await new Promise((res) => pruneCheckpoints(workdir, () => res()));

  console.log(
    `[syncUiSource] source=${source} githubOk=${githubOk} dir=${uiDir}`,
  );
  return { source, githubOk };
}

// ---------------------------------------------------------------------------
// Bounded retention for the agent's local git history
// ---------------------------------------------------------------------------
// Dist snapshots (MAX_DIST_VERSIONS), SQLite backups (MAX_BACKUPS) and the
// audit log are already capped elsewhere — but the agent's local git repo
// (/app/workspace/opencode-ui/.git) accumulated checkpoints (and resync
// commits) forever, so the persistent volume could slowly fill. pruneCheckpoints()
// compacts unreachable/loose objects with `git gc` so the repo stays tiny even
// after hundreds of small text checkpoints. Best-effort: never throws.
export async function pruneCheckpoints(workdir) {
  const uiDir = getUiDir(workdir);
  if (!fs.existsSync(path.join(uiDir, ".git"))) return;
  try {
    await execFileP("git", ["reflog", "expire", "--expire=now", "--all"], {
      cwd: uiDir,
      timeout: 10000,
    });
    await execFileP("git", ["gc", "--prune=now"], {
      cwd: uiDir,
      timeout: 30000,
    });
  } catch (e) {
    console.error("[pruneCheckpoints] failed:", e.message);
  }
}

// Hard cap on the number of commits in the agent's local git history.
// Once reached, new checkpoints amend the latest commit instead of adding a
// new one, so the chain length stays bounded (pruneCheckpoints() already keeps
// the on-disk size small). Override with SELF_IMPROVE_MAX_CHECKPOINTS.
const MAX_CHECKPOINTS = Number(process.env.SELF_IMPROVE_MAX_CHECKPOINTS) || 100;

/**
 * Create a commit, capping the history length. When there are already
 * MAX_CHECKPOINTS commits, amend the latest instead of adding a new one.
 * Best-effort (falls back to an empty commit if amend fails).
 */
async function commitBounded(uiDir, message) {
  try {
    const { stdout: countOut } = await execFileP(
      "git",
      ["rev-list", "--count", "HEAD"],
      { cwd: uiDir, timeout: 10000 },
    );
    const count = parseInt((countOut || "0").trim(), 10) || 0;
    if (count >= MAX_CHECKPOINTS) {
      try {
        await execFileP("git", ["commit", "--amend", "-m", message], {
          cwd: uiDir,
          timeout: 15000,
        });
      } catch (err) {
        // Amend can fail on an unchanged tree — fall back to an empty commit.
        await execFileP("git", ["commit", "-m", message, "--allow-empty"], {
          cwd: uiDir,
          timeout: 15000,
        });
      }
    } else {
      await execFileP("git", ["commit", "-m", message], {
        cwd: uiDir,
        timeout: 15000,
      });
    }
  } catch (err) {
    throw new Error(`commitBounded failed: ${err.message}`);
  }
}

/**
 * Check if self-improve mode is enabled.
 */
export function isSelfImproveEnabled(workdir) {
  const flagFile = path.join(workdir, ".self_improve_mode");
  try {
    return (
      fs.existsSync(flagFile) &&
      fs.readFileSync(flagFile, "utf8").trim() === "true"
    );
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
    console.error(
      "[Self-Improve] failed to store self-improve session id:",
      e.message,
    );
  }
}

/**
 * Toggle self-improve mode.
 * Flag-only — never chmod. In Docker, chmod -R was freezing the event loop
 * (and is not a real security boundary for root processes anyway).
 * Write access is gated by sandbox allowlist + admin routes, not filesystem mode.
 */

function selfImproveWorkspaceFilter(src) {
  const base = path.basename(src);
  return ![
    "node_modules",
    ".git",
    ".sqlite_migrated",
    ".self_improve_session",
    INTERNAL_TOKEN_FILE,
  ].includes(base);
}

export function getSiInternalTokenPath(workdir, sessionId) {
  return path.join(
    workdir,
    "sessions",
    sessionId,
    "workspace",
    INTERNAL_TOKEN_FILE,
  );
}

export function ensureSiInternalToken(workdir, sessionId) {
  const tokenPath = getSiInternalTokenPath(workdir, sessionId);
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  if (!fs.existsSync(tokenPath)) {
    fs.writeFileSync(tokenPath, crypto.randomBytes(32).toString("hex"), {
      mode: 0o600,
    });
  }
  try {
    fs.chmodSync(tokenPath, 0o600);
  } catch (e) {
    console.warn("Ignored error:", e);
  }
  return fs.readFileSync(tokenPath, "utf8").trim();
}

export function isSiInternalRequest(workdir, req, urlPath) {
  const remote = req.socket?.remoteAddress || "";
  if (
    remote !== "127.0.0.1" &&
    remote !== "::1" &&
    remote !== "::ffff:127.0.0.1"
  )
    return false;
  const token = req.headers["x-si-internal-token"];
  const sessionId = req.headers["x-si-session-id"];
  const configured = getSelfImproveSessionId(workdir);
  const allowed =
    req.method === "POST" && urlPath === "/api/self-improve/create-pr";
  if (
    !allowed ||
    typeof token !== "string" ||
    typeof sessionId !== "string" ||
    sessionId !== configured
  )
    return false;
  try {
    const expected = ensureSiInternalToken(workdir, sessionId);
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function refreshSelfImproveWorkspace(workdir, sessionId) {
  const sessionWorkspace = path.join(
    workdir,
    "sessions",
    sessionId,
    "workspace",
  );
  const uiDir = getUiDir(workdir);
  if (!fs.existsSync(uiDir)) throw new Error(`UI source missing: ${uiDir}`);
  fs.rmSync(sessionWorkspace, { recursive: true, force: true });
  fs.mkdirSync(sessionWorkspace, { recursive: true });
  fs.cpSync(uiDir, sessionWorkspace, {
    recursive: true,
    filter: selfImproveWorkspaceFilter,
  });
  ensureSiInternalToken(workdir, sessionId);
  console.log(
    `[Self-Improve Sandbox] Workspace refreshed for session ${sessionId}`,
  );
}

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
 * Run npm install + vite build using execFile (no shell interpolation).
 * All arguments are hardcoded constants — no user input reaches the command.
 */
async function runBuild(cwd) {
  // Resource-constrained hosts can OOM during a full Vite build.
  // and gets OOM-killed. We try a minimal config (no PWA/react-compiler)
  // to reduce memory. If it still fails, we return an error and keep the
  // existing Docker-built dist intact — the user should git push for a
  // proper rebuild in a sufficiently provisioned Docker environment.
  // DO NOT fall back to esbuild — its ESM output loads but React never
  // mounts (blank page), which is worse than keeping the old dist.
  const env = { ...process.env, NODE_OPTIONS: "--max-old-space-size=4096" };
  let stdout1, stderr1;
  try {
    ({ stdout: stdout1, stderr: stderr1 } = await execFileP(
      "npm",
      ["install", "--silent"],
      { cwd, timeout: REBUILD_NPM_TIMEOUT_MS, env },
    ));
  } catch (err1) {
    throw new Error(`npm install failed: ${err1.stderr || err1.message}`);
  }
  // Build outside the live directory. A successful build is swapped in only
  // after Vite finishes, so a failed/partial build cannot damage the live UI.
  const buildDir = path.join(
    path.dirname(BUILD_OUT_DIR),
    `.dist-rebuild-${process.pid}-${Date.now()}`,
  );
  fs.rmSync(buildDir, { recursive: true, force: true });
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
    outDir: "${buildDir.replace(/\\/g, "/")}",
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        entryFileNames: "assets/index-rebuilt-[hash].js",
        chunkFileNames: "assets/chunk-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
`;
  const configPath = path.join(cwd, "vite.rebuild.config.ts");
  fs.writeFileSync(configPath, minimalConfig);

  let stdout2, stderr2;
  try {
    ({ stdout: stdout2, stderr: stderr2 } = await execFileP(
      "npx",
      ["vite", "build", "--config", configPath],
      {
        cwd,
        timeout: REBUILD_VITE_TIMEOUT_MS,
        env,
        maxBuffer: 20 * 1024 * 1024,
      },
    ));
  } catch (err2) {
    fs.rmSync(buildDir, { recursive: true, force: true });
    // Vite failed (likely OOM). Return error — do NOT fall back to
    // esbuild (its ESM output produces a blank page).
    const isOOM =
      (err2.stderr || "").includes("Killed") || err2.message.includes("Killed");
    throw new Error(
      isOOM
        ? `vite build was killed (OOM). Rebuild on a host with sufficient memory, or deploy through the Docker pipeline.`
        : `vite build failed: ${err2.stderr || err2.message}`,
    );
  } finally {
    // Clean up temp config
    try {
      fs.unlinkSync(configPath);
    } catch (e) {
      console.warn("Ignored error:", e);
    }
  }

  // Vite succeeded: atomically replace the live dist with the clean,
  // hashed build. The old directory is retained only until the swap
  // completes, then removed to avoid stale index-rebuilt assets.
  try {
    const oldDir = `${BUILD_OUT_DIR}.previous-${process.pid}-${Date.now()}`;
    if (fs.existsSync(oldDir))
      fs.rmSync(oldDir, { recursive: true, force: true });
    if (fs.existsSync(BUILD_OUT_DIR)) fs.renameSync(BUILD_OUT_DIR, oldDir);
    fs.renameSync(buildDir, BUILD_OUT_DIR);
    fs.rmSync(oldDir, { recursive: true, force: true });
    promoteDistSnapshot();
  } catch (swapErr) {
    fs.rmSync(buildDir, { recursive: true, force: true });
    throw new Error(`vite build output swap failed: ${swapErr.message}`);
  }
  return `${stdout1 || ""}\n${stdout2 || ""}`;
}

/**
 * Rebuild the UI (npm install + vite build).
 */
export async function rebuildUi(workdir) {
  const uiDir = getUiDir(workdir);
  if (!fs.existsSync(uiDir)) {
    throw new Error("Directory opencode-ui not found in workspace.");
  }
  console.log("[Rebuild] Starting rebuild...");
  try {
    const stdout = await runBuild(uiDir);
    console.log("[Rebuild] Successfully rebuilt UI!");
    return stdout;
  } catch (err) {
    console.error("[Rebuild] Failed:", err.message);
    throw err;
  }
}

/**
 * Reset UI to factory version and rebuild.
 */
export async function resetUi(workdir) {
  const uiDir = getUiDir(workdir);
  const srcDir = "/app/workspace-src";

  if (!fs.existsSync(srcDir)) {
    throw new Error("Factory source directory /app/workspace-src not found.");
  }

  await execFileP("mkdir", ["-p", path.join(uiDir, "src")], { timeout: 10000 });
  await execFileP(
    "cp",
    ["-rf", `${path.join(srcDir, "src")}/.`, `${path.join(uiDir, "src")}/`],
    { timeout: 30000 },
  );

  const publicSrc = path.join(srcDir, "public");
  const publicDest = path.join(uiDir, "public");
  try {
    fs.rmSync(publicDest, { recursive: true, force: true });
    if (fs.existsSync(publicSrc))
      fs.cpSync(publicSrc, publicDest, { recursive: true });
  } catch (e) {
    console.warn(`[Reset UI] Could not copy public/: ${e.message}`);
  }
  for (const file of ROOT_FILES) {
    const src = path.join(srcDir, file);
    const dest = path.join(uiDir, file);
    try {
      if (fs.existsSync(src)) fs.copyFileSync(src, dest);
    } catch (e) {
      console.warn(`[Reset UI] Could not copy ${src}: ${e.message}`);
    }
  }

  console.log("[Reset UI] Copied factory files, rebuilding...");
  try {
    const stdout = await runBuild(uiDir);
    console.log("[Reset UI] Successfully reset and rebuilt UI!");
    return stdout;
  } catch (err) {
    console.error("[Reset UI] Failed:", err.message);
    throw err;
  }
}

/**
 * Create a git checkpoint.
 */
export async function createCheckpoint(workdir) {
  const uiDir = getUiDir(workdir);
  if (!fs.existsSync(uiDir)) {
    throw new Error("Directory opencode-ui not found.");
  }

  const { stdout: statusOut } = await execFileP(
    "git",
    ["status", "--porcelain"],
    { cwd: uiDir, timeout: 10000 },
  );
  if (!statusOut?.trim()) {
    const { stdout: logOut } = await execFileP(
      "git",
      ["log", "-1", "--format=%h — %s (%cr)"],
      { cwd: uiDir, timeout: 10000 },
    );
    return {
      status: "noop",
      message: "No changes to save",
      commit: logOut?.trim() || "",
    };
  }

  const now = new Date();
  const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  const msg = `Checkpoint: ${timeStr} (by UI)`;

  await execFileP("git", ["add", "."], { cwd: uiDir, timeout: 10000 });
  // Hard cap on checkpoint count: once we have MAX_CHECKPOINTS commits,
  // fold new changes into the latest commit (amend) instead of adding a
  // new one. Bounds history length without fragile history rewriting.
  await commitBounded(uiDir, msg);

  const { stdout: commitOut } = await execFileP(
    "git",
    ["log", "-1", "--format=%h — %s (%cr)"],
    { cwd: uiDir, timeout: 10000 },
  );
  console.log(`[Checkpoint] Created: ${commitOut?.trim()}`);
  pruneCheckpoints(workdir).catch(() => {}); // best-effort: keep history bounded
  return {
    status: "success",
    message: "Checkpoint created!",
    commit: commitOut?.trim() || "",
  };
}

/**
 * Return a bounded unified diff for the self-improve source workspace.
 * Only src/** is mutable through the sandbox, so no secrets or runtime files are exposed.
 */
export async function getWorkingDiff(workdir) {
  const uiDir = getUiDir(workdir);
  if (!fs.existsSync(path.join(uiDir, ".git")))
    return { diff: "", changed: false };
  const { stdout } = await execFileP(
    "git",
    ["diff", "--no-ext-diff", "--", "src"],
    { cwd: uiDir, timeout: 10000, maxBuffer: 512 * 1024 },
  );
  const diff = (stdout || "").slice(0, 500 * 1024);
  return { diff, changed: diff.length > 0 };
}

/**
 * List git checkpoints.
 */
export async function listCheckpoints(workdir) {
  const uiDir = getUiDir(workdir);
  if (!fs.existsSync(uiDir)) {
    return [];
  }
  // If .git doesn't exist, return empty list instead of failing — start.sh
  // initializes it on next boot, but we shouldn't 500 in the meantime.
  if (!fs.existsSync(path.join(uiDir, ".git"))) {
    return [];
  }

  try {
    const { stdout } = await execFileP(
      "git",
      ["log", "-n", "15", "--format=%h|%s|%cr"],
      { cwd: uiDir, timeout: 10000 },
    );
    const commits = (stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const parts = line.split("|");
        return {
          hash: parts[0] || "",
          subject: parts[1] || "",
          time: parts[2] || "",
        };
      });
    return commits;
  } catch (err) {
    return [];
  }
}

/**
 * Rollback to a specific commit and rebuild.
 * hash is validated by caller (regex /^[a-fA-F0-9]{4,40}$/) — safe for execFile.
 */
export async function rollbackToCommit(workdir, hash) {
  const uiDir = getUiDir(workdir);

  try {
    await execFileP("git", ["reset", "--hard", hash], {
      cwd: uiDir,
      timeout: 30000,
    });
  } catch (err1) {
    console.error("[Rollback] git reset failed:", err1.message);
    throw err1;
  }

  try {
    await execFileP("git", ["clean", "-fd"], { cwd: uiDir, timeout: 30000 });
  } catch (err2) {
    console.error("[Rollback] git clean failed:", err2.message);
    throw err2;
  }

  console.log(`[Rollback] Rolled back to ${hash}, rebuilding...`);
  try {
    await runBuild(uiDir);
    console.log(`[Rollback] Successfully rolled back to ${hash}!`);
    return { message: `Rolled back to ${hash}` };
  } catch (err) {
    console.error("[Rollback] Build failed:", err.message);
    throw err;
  }
}

export { logAudit, readAuditLog } from "./self-improve-audit.mjs";
export {
  instantRollbackDist,
  listDistSnapshots,
  promoteDistSnapshot,
  restoreLatestDist,
} from "./self-improve-dist.mjs";
