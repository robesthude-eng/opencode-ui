import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkRateLimit,
  MAX_JSON_BODY_BYTES,
  readBody,
} from "./middleware.mjs";
import { logAudit } from "./self-improve.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAX_SANDBOX_FILES = 20;
// JSON bodies are capped at 256 KB by middleware; leave room for path and JSON overhead.
const MAX_SANDBOX_CONTENT_BYTES = 200 * 1024;
const SANDBOX_BIOME_TIMEOUT_MS =
  Number(process.env.SELF_IMPROVE_BIOME_TIMEOUT_MS) || 60_000;
const SANDBOX_TSC_TIMEOUT_MS =
  Number(process.env.SELF_IMPROVE_TSC_TIMEOUT_MS) || 120_000;
const SANDBOX_TEST_TIMEOUT_MS =
  Number(process.env.SELF_IMPROVE_TEST_TIMEOUT_MS) || 120_000;
const SANDBOX_VITE_TIMEOUT_MS =
  Number(process.env.SELF_IMPROVE_VITE_TIMEOUT_MS) || 300_000;
let sandboxRunInProgress = false;

/**
 * Validate one user-controlled path before it reaches either the sandbox or the
 * persistent source tree. String-prefix checks are not sufficient here:
 * "src/../package.json" starts with "src/" but escapes the intended scope.
 */
export function normalizeSandboxPath(inputPath) {
  if (typeof inputPath !== "string" || !inputPath) {
    throw new Error("file path must be a non-empty string");
  }
  const raw = inputPath.replace(/\\/g, "/");
  const segments = raw.split("/");
  if (
    raw.includes("\0") ||
    path.posix.isAbsolute(raw) ||
    segments.some((segment) => segment === "..")
  ) {
    throw new Error("path traversal is not allowed");
  }
  const normalized = path.posix.normalize(raw).replace(/^\.\//, "");
  if (!normalized.startsWith("src/") || normalized === "src/") {
    throw new Error("only files under src/** may be changed");
  }
  return normalized;
}

/** Resolve a previously validated relative path and enforce an exact directory boundary. */
export function resolveInside(rootDir, relativePath) {
  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("resolved path escapes its allowed directory");
  }
  return resolved;
}

/**
 * Apply a validated source batch in a reversible transaction. If a following
 * checkpoint cannot be created, the returned rollback restores the exact
 * pre-deploy contents (including removal of newly created files).
 */
export function applySourceChangesTransaction(activeUiDir, files) {
  const previous = files.map((file) => {
    const destination = resolveInside(activeUiDir, file.path);
    const existed = fs.existsSync(destination);
    return {
      destination,
      existed,
      content: existed ? fs.readFileSync(destination) : null,
    };
  });

  try {
    for (const [index, file] of files.entries()) {
      const destination = previous[index].destination;
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, file.content, "utf8");
    }
  } catch (error) {
    rollbackSourceChanges(previous);
    throw error;
  }

  return () => rollbackSourceChanges(previous);
}

function rollbackSourceChanges(previous) {
  for (const file of previous) {
    try {
      if (file.existed) {
        fs.mkdirSync(path.dirname(file.destination), { recursive: true });
        fs.writeFileSync(file.destination, file.content);
      } else {
        fs.rmSync(file.destination, { force: true });
      }
    } catch (error) {
      console.error(
        `[Sandbox] rollback failed for ${file.destination}:`,
        error.message,
      );
    }
  }
}

export function validateSandboxFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("files array is required");
  }
  if (files.length > MAX_SANDBOX_FILES) {
    throw new Error(
      `at most ${MAX_SANDBOX_FILES} files may be changed per request`,
    );
  }

  let totalBytes = 0;
  const seen = new Set();
  return files.map((file) => {
    if (!file || typeof file !== "object" || typeof file.content !== "string") {
      throw new Error("each file requires string path and content fields");
    }
    const normalizedPath = normalizeSandboxPath(file.path);
    if (seen.has(normalizedPath)) {
      throw new Error(`duplicate file path: ${normalizedPath}`);
    }
    seen.add(normalizedPath);
    totalBytes += Buffer.byteLength(file.content, "utf8");
    if (totalBytes > MAX_SANDBOX_CONTENT_BYTES) {
      throw new Error("total changed source exceeds the 200 KB request limit");
    }
    return { ...file, path: normalizedPath };
  });
}

export function tryAcquireSandboxRun() {
  if (sandboxRunInProgress) return false;
  sandboxRunInProgress = true;
  return true;
}

export function releaseSandboxRun() {
  sandboxRunInProgress = false;
}

export async function handleSandboxRequest(req, res, WORKDIR, userEmail) {
  if (!(await checkRateLimit(res))) return;

  const urlPath = req.url.split("?")[0];

  if (urlPath === "/api/sandbox/apply" && req.method === "POST") {
    readBody(req, MAX_JSON_BODY_BYTES)
      .then((buf) => {
        try {
          const { files, dryRun = true } = JSON.parse(
            buf.toString("utf8") || "{}",
          );
          let safeFiles;
          try {
            safeFiles = validateSandboxFiles(files);
          } catch (validationError) {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: `Sandbox security: ${validationError.message}. Allowed: src/** only.`,
              }),
            );
            return;
          }

          // A run holds a shared /tmp workspace and can invoke several expensive
          // tools. Do not let concurrent admin requests corrupt each other's tree.
          if (!tryAcquireSandboxRun()) {
            res.writeHead(409, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error:
                  "A sandbox run is already in progress. Try again shortly.",
              }),
            );
            return;
          }

          let finished = false;
          const finish = (err, result) => {
            if (finished) return;
            finished = true;
            releaseSandboxRun();
            if (err) {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  status: "error",
                  error: "Internal sandbox error",
                  detail: err.message,
                }),
              );
            } else {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(result));
            }
          };

          try {
            runSandboxCheck(WORKDIR, safeFiles, dryRun, userEmail, finish, 2);
          } catch (runError) {
            finish(runError);
          }
        } catch (_e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON payload" }));
        }
      })
      .catch(() => {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Request body too large" }));
      });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Sandbox endpoint not found." }));
}

// UX-fix: tsc-b может выводить ошибки в stdout ИЛИ stderr — склеиваем обоих
// и убираем шум (progress lines, empty lines), оставляя только настоящие diagnostics.
function parseTscOutput(err, stdout, stderr) {
  const combined = [stdout, stderr, err?.message || ""]
    .filter(Boolean)
    .join("\n")
    .trim();
  if (!combined) {
    return [
      "No output from tsc. Check that files are inside src/ and match tsconfig.json include glob.",
    ];
  }
  // строки, похожие на настоящие TS-диагностики: содержат ".ts(line,col): error TSxxxx"
  const diagLines = combined
    .split("\n")
    .filter((l) => /\.tsx?\(\d+,\d+\)|error TS\d+/.test(l));
  if (diagLines.length > 0) return diagLines.slice(0, 20);
  // fallback: любые непустые строки, но не более 10
  return combined.split("\n").filter(Boolean).slice(0, 10);
}

async function runSandboxCheck(
  workdir,
  files,
  dryRun,
  userEmail,
  callback,
  attemptsLeft = 2,
) {
  setTestStatus(workdir, "running");
  const activeUiDir = path.join(workdir, "opencode-ui");
  const sandboxDir = "/tmp/opencode-ui-sandbox";

  try {
    if (fs.existsSync(sandboxDir)) {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    }
    fs.mkdirSync(sandboxDir, { recursive: true });
  } catch (e) {
    return callback(
      new Error(`Failed to initialize sandbox directory: ${e.message}`),
    );
  }

  copyFolderRecursiveSync(activeUiDir, sandboxDir, [
    "node_modules",
    ".git",
    "dist",
  ]);

  try {
    const activeNodeModules = path.join(activeUiDir, "node_modules");
    const globalNodeModules = "/app/node_modules";
    const sandboxNodeModules = path.join(sandboxDir, "node_modules");
    // Prefer sandbox-local node_modules if npm-installed inside workspace,
    // otherwise fall back to /app/node_modules where the container has full deps
    // (self-improve sandbox requires tsc/vitest/biome to be reachable).
    let source = null;
    if (fs.existsSync(activeNodeModules)) source = activeNodeModules;
    else if (fs.existsSync(globalNodeModules)) source = globalNodeModules;
    if (source) {
      try {
        fs.unlinkSync(sandboxNodeModules);
      } catch {}
      fs.symlinkSync(source, sandboxNodeModules);
      console.log(`[Sandbox] node_modules → ${source}`);
    } else {
      console.warn(
        "[Sandbox] no node_modules found — tsc/vitest/biome will fail",
      );
    }
  } catch (e) {
    return callback(new Error(`Failed to symlink node_modules: ${e.message}`));
  }

  for (const f of files) {
    let resolvedPath;
    try {
      resolvedPath = resolveInside(sandboxDir, f.path);
    } catch (e) {
      return callback(
        new Error(
          `Security violation: path ${f.path} escapes sandbox: ${e.message}`,
        ),
      );
    }
    try {
      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
      fs.writeFileSync(resolvedPath, f.content, "utf8");
    } catch (e) {
      return callback(
        new Error(`Failed to write file ${f.path} in sandbox: ${e.message}`),
      );
    }
  }

  const execFileAsync = (cmd, args, opts) =>
    new Promise((resolve) => {
      execFile(cmd, args, opts, (err, stdout, stderr) => {
        resolve({ err, stdout, stderr });
      });
    });

  // Step 4.5: Run Biome to auto-format files in sandbox
  const filesToFormat = files.map((f) => path.join(sandboxDir, f.path));
  console.log("[Sandbox] Auto-formatting files with Biome...");
  const { err: biomeErr, stderr: biomeStderr } = await execFileAsync(
    "npx",
    ["biome", "check", "--write", "--unsafe", ...filesToFormat],
    { cwd: sandboxDir, timeout: SANDBOX_BIOME_TIMEOUT_MS },
  );

  if (biomeErr) {
    console.warn(
      "[Sandbox] Biome format warning:",
      biomeStderr || biomeErr.message,
    );
    // Non-fatal for format; tsc/vitest remain hard gates
  } else {
    console.log("[Sandbox] Files successfully formatted with Biome!");
    // Update our files array with the newly formatted content from disk so we deploy the formatted version!
    for (const f of files) {
      try {
        const filePath = path.join(sandboxDir, f.path);
        f.content = fs.readFileSync(filePath, "utf8");
      } catch (e) {
        console.warn(
          `[Sandbox] Failed to read formatted content for ${f.path}:`,
          e.message,
        );
      }
    }
  }

  // Step 5: Run TypeScript compilation check
  console.log("[Sandbox] Starting pre-flight compilation check...");
  const {
    err: tscErr,
    stdout: tscStdout,
    stderr: tscStderr,
  } = await execFileAsync("./node_modules/.bin/tsc", ["-b"], {
    cwd: sandboxDir,
    timeout: SANDBOX_TSC_TIMEOUT_MS,
  });

  if (tscErr) {
    const compileErrors = parseTscOutput(tscErr, tscStdout, tscStderr);
    console.log("[Sandbox] Compilation check failed.");

    if (attemptsLeft > 0) {
      console.log(
        `[Sandbox] Attempting autonomous self-correction (${3 - attemptsLeft + 1}/2)...`,
      );
      try {
        const acModule = await import("./auto-correct.mjs");
        const correctedFiles = await new Promise((resolve, reject) => {
          acModule.runAutoCorrection(
            files,
            compileErrors,
            (acErr, resFiles) => {
              if (acErr || !resFiles) reject(acErr || new Error("No output"));
              else resolve(resFiles);
            },
            { directory: sandboxDir },
          );
        });

        console.log(
          "[Sandbox] Re-running sandbox compilation check with auto-corrected files...",
        );
        // P0-fix (безопасность): файлы от auto-correction пришли от LLM —
        // обязательно прогоняем через ту же валидацию песочницы, что и
        // файлы из HTTP-запроса: только src/**, без path traversal,
        // с лимитами на кол-во и суммарный размер. Иначе авто-коррекция
        // могла записать файл вне src/ и обойти изоляцию.
        let safeCorrectedFiles;
        try {
          safeCorrectedFiles = validateSandboxFiles(correctedFiles);
        } catch (valErr) {
          console.warn(
            "[Sandbox] Auto-corrected files failed sandbox validation, rejecting:",
            valErr.message,
          );
          return callback(null, {
            status: "compilation_failed",
            errors: compileErrors,
            message:
              "Compilation failed. Auto-correction produced files outside the sandbox; changes were rejected for safety.",
          });
        }
        runSandboxCheck(
          workdir,
          safeCorrectedFiles,
          dryRun,
          userEmail,
          (retryErr, retryResult) => {
            if (retryErr) return callback(retryErr);
            if (retryResult.status === "success") {
              retryResult.autoCorrected = true;
              retryResult.message =
                "Initial compilation failed, but we automatically corrected the errors in the sandbox and successfully deployed the clean code!";
            }
            callback(null, retryResult);
          },
          attemptsLeft - 1,
        );
        return;
      } catch (acModuleErr) {
        console.warn(
          "[Sandbox] Failed to load auto-correct module:",
          acModuleErr.message,
        );
        return callback(null, {
          status: "compilation_failed",
          message:
            "TypeScript compilation failed. Auto-correction module not available.",
          errors: compileErrors,
        });
      }
    }

    setTestStatus(workdir, "failure", compileErrors);
    return callback(null, {
      status: "compilation_failed",
      message:
        "TypeScript compilation failed. Fix the errors below and try again.",
      errors: compileErrors,
    });
  }

  console.log("[Sandbox] Compilation check succeeded!");

  // Step 5.5: Run vitest. Self-improve deploys may not bypass tests.
  console.log("[Sandbox] Running vitest...");
  const {
    err: testErr,
    stdout: testStdout,
    stderr: testStderr,
  } = await execFileAsync("npx", ["vitest", "run", "--reporter=dot"], {
    cwd: sandboxDir,
    timeout: SANDBOX_TEST_TIMEOUT_MS,
  });

  if (testErr) {
    const testOutput = `${testStdout}\n${testStderr}`
      .trim()
      .split("\n")
      .slice(-30);
    console.log("[Sandbox] Tests failed.");
    setTestStatus(workdir, "failure", testOutput);
    return callback(null, {
      status: "tests_failed",
      message:
        "TypeScript compiled, but tests failed. Fix failing tests before deploy.",
      errors: testOutput,
    });
  }
  console.log("[Sandbox] Tests passed!");

  // Step 5.75: vite build in sandbox (catches Vite-specific errors)
  console.log("[Sandbox] Running vite build (pre-deploy)...");
  const {
    err: buildErr,
    stdout: buildStdout,
    stderr: buildStderr,
  } = await execFileAsync(
    "npx",
    ["vite", "build", "--outDir", path.join(sandboxDir, "dist-check")],
    { cwd: sandboxDir, timeout: SANDBOX_VITE_TIMEOUT_MS },
  );

  if (buildErr) {
    const out = `${buildStdout || ""}\n${buildStderr || ""}`
      .trim()
      .split("\n")
      .slice(-40);
    console.log("[Sandbox] vite build failed.");
    setTestStatus(workdir, "failure", out);
    return callback(null, {
      status: "build_failed",
      message: "TypeScript + tests passed, but vite build failed.",
      errors: out,
    });
  }
  console.log("[Sandbox] vite build succeeded!");

  if (dryRun) {
    setTestStatus(workdir, "success");
    return callback(null, {
      status: "success",
      message:
        "Pre-flight compilation + tests + vite build succeeded! Code is clean and safe to deploy.",
    });
  }

  console.log("[Sandbox] Deploying code from sandbox to active repository...");
  logAudit(
    workdir,
    userEmail,
    "SANDBOX_DEPLOY_START",
    `Deploying changes for ${files.length} files`,
  );

  let rollbackSource;
  try {
    rollbackSource = applySourceChangesTransaction(activeUiDir, files);
  } catch (e) {
    logAudit(workdir, userEmail, "SANDBOX_DEPLOY_FAILED", e.message);
    return callback(
      new Error(`Failed to deploy files to active codebase: ${e.message}`),
    );
  }

  const { err: gitErr, stdout: commitMessage } = await new Promise(
    (resolve) => {
      createGitCheckpoint(activeUiDir, files, (err, msg) => {
        resolve({ err, stdout: msg });
      });
    },
  );

  if (gitErr) {
    rollbackSource();
    await execFileAsync(
      "git",
      ["reset", "--", ...files.map((file) => file.path)],
      { cwd: activeUiDir, timeout: 10000 },
    );
    logAudit(
      workdir,
      userEmail,
      "SANDBOX_DEPLOY_ROLLED_BACK",
      `Git checkpoint failed; restored previous source: ${gitErr.message}`,
    );
    return callback(
      new Error(
        `Git checkpoint failed; source changes were rolled back: ${gitErr.message}`,
      ),
    );
  }

  logAudit(
    workdir,
    userEmail,
    "SANDBOX_DEPLOY_SUCCESS",
    `Source checkpoint: ${commitMessage}; rebuild required before release`,
  );
  setTestStatus(workdir, "success");
  callback(null, {
    status: "success",
    message:
      "Source changes passed validation and were checkpointed. Run /api/rebuild to publish the new UI.",
    commit: commitMessage,
    rebuildRequired: true,
    rebuildEndpoint: "/api/rebuild",
  });
}

function createGitCheckpoint(repoDir, files, callback) {
  const modifiedFiles = files.map((f) => f.path).join(", ");
  const now = new Date();
  const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  const msg = `Auto-Improve: Compile success at ${timeStr} (files: ${modifiedFiles})`;

  execFile(
    "git",
    ["add", "--", ...files.map((file) => file.path)],
    { cwd: repoDir, timeout: 10000 },
    (err1) => {
      if (err1) return callback(new Error("git add failed"));

      execFile(
        "git",
        ["commit", "-m", msg],
        { cwd: repoDir, timeout: 15000 },
        (err2) => {
          if (err2) {
            return callback(err2);
          }
          execFile(
            "git",
            ["log", "-1", "--format=%h — %s"],
            { cwd: repoDir, timeout: 10000 },
            (_err3, commitOut) => {
              callback(null, commitOut?.trim() || msg);
            },
          );
        },
      );
    },
  );
}

function copyFolderRecursiveSync(src, dest, excludes = []) {
  if (!fs.existsSync(src)) return;
  const stats = fs.statSync(src);

  if (stats.isDirectory()) {
    const base = path.basename(src);
    if (excludes.includes(base)) return;

    fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach((child) => {
      copyFolderRecursiveSync(
        path.join(src, child),
        path.join(dest, child),
        excludes,
      );
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

// ===========================================================================
// Test and Build status persistence (P2)
// ===========================================================================
export function getTestStatus(workdir) {
  const file = path.join(workdir, ".self_improve_test_status");
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    }
  } catch {}
  return { status: "idle", errors: [] };
}

export function setTestStatus(workdir, status, errors = []) {
  const file = path.join(workdir, ".self_improve_test_status");
  try {
    fs.writeFileSync(
      file,
      JSON.stringify({ status, errors, timestamp: Date.now() }),
      "utf8",
    );
  } catch (e) {
    console.error("[Sandbox] Failed to write test status:", e.message);
  }
}
