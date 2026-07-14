import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkRateLimit, MAX_JSON_BODY_BYTES, readBody } from "./middleware.mjs";
import { logAudit } from "./self-improve.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAX_SANDBOX_FILES = 20;
// JSON bodies are capped at 256 KB by middleware; leave room for path and JSON overhead.
const MAX_SANDBOX_CONTENT_BYTES = 200 * 1024;
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

export function validateSandboxFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("files array is required");
  }
  if (files.length > MAX_SANDBOX_FILES) {
    throw new Error(`at most ${MAX_SANDBOX_FILES} files may be changed per request`);
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

export function handleSandboxRequest(req, res, WORKDIR, userEmail) {
  if (!checkRateLimit(res)) return;

  const urlPath = req.url.split("?")[0];

  if (urlPath === "/api/sandbox/apply" && req.method === "POST") {
    readBody(req, MAX_JSON_BODY_BYTES)
      .then((buf) => {
        try {
          const {
            files,
            dryRun = true,
            skipTests = false,
          } = JSON.parse(buf.toString("utf8") || "{}");
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
              JSON.stringify({ error: "A sandbox run is already in progress. Try again shortly." }),
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
            runSandboxCheck(WORKDIR, safeFiles, dryRun, userEmail, finish, 2, { skipTests });
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
  const combined = [stdout, stderr, err?.message || ""].filter(Boolean).join("\n").trim();
  if (!combined) {
    return [
      "No output from tsc. Check that files are inside src/ and match tsconfig.json include glob.",
    ];
  }
  // строки, похожие на настоящие TS-диагностики: содержат ".ts(line,col): error TSxxxx"
  const diagLines = combined.split("\n").filter((l) => /\.tsx?\(\d+,\d+\)|error TS\d+/.test(l));
  if (diagLines.length > 0) return diagLines.slice(0, 20);
  // fallback: любые непустые строки, но не более 10
  return combined.split("\n").filter(Boolean).slice(0, 10);
}

function runSandboxCheck(
  workdir,
  files,
  dryRun,
  userEmail,
  callback,
  attemptsLeft = 2,
  options = {},
) {
  const activeUiDir = path.join(workdir, "opencode-ui");
  const sandboxDir = "/tmp/opencode-ui-sandbox";

  try {
    if (fs.existsSync(sandboxDir)) {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    }
    fs.mkdirSync(sandboxDir, { recursive: true });
  } catch (e) {
    return callback(new Error(`Failed to initialize sandbox directory: ${e.message}`));
  }

  copyFolderRecursiveSync(activeUiDir, sandboxDir, ["node_modules", ".git", "dist"]);

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
      console.warn("[Sandbox] no node_modules found — tsc/vitest/biome will fail");
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
        new Error(`Security violation: path ${f.path} escapes sandbox: ${e.message}`),
      );
    }
    try {
      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
      fs.writeFileSync(resolvedPath, f.content, "utf8");
    } catch (e) {
      return callback(new Error(`Failed to write file ${f.path} in sandbox: ${e.message}`));
    }
  }

  // Step 4.5: Run Biome to auto-format files in sandbox
  const filesToFormat = files.map((f) => path.join(sandboxDir, f.path));
  console.log("[Sandbox] Auto-formatting files with Biome...");
  execFile(
    "npx",
    ["biome", "check", "--write", "--unsafe", ...filesToFormat],
    { cwd: sandboxDir, timeout: 30000 },
    (biomeErr, _biomeStdout, biomeStderr) => {
      if (biomeErr) {
        console.warn("[Sandbox] Biome format warning:", biomeStderr || biomeErr.message);
        // Non-fatal for format; tsc/vitest remain hard gates
      } else {
        console.log("[Sandbox] Files successfully formatted with Biome!");
        // Update our files array with the newly formatted content from disk so we deploy the formatted version!
        for (const f of files) {
          try {
            const filePath = path.join(sandboxDir, f.path);
            f.content = fs.readFileSync(filePath, "utf8");
          } catch (e) {
            console.warn(`[Sandbox] Failed to read formatted content for ${f.path}:`, e.message);
          }
        }
      }

      // Step 5: Run TypeScript compilation check
      console.log("[Sandbox] Starting pre-flight compilation check...");
      execFile(
        "./node_modules/.bin/tsc",
        ["-b"],
        { cwd: sandboxDir, timeout: 30000 },
        (err, stdout, stderr) => {
          if (err) {
            const compileErrors = parseTscOutput(err, stdout, stderr);
            console.log("[Sandbox] Compilation check failed.");

            if (attemptsLeft > 0) {
              console.log(
                `[Sandbox] Attempting autonomous self-correction (${3 - attemptsLeft + 1}/2)...`,
              );
              import("./auto-correct.mjs")
                .then((ac) => {
                  ac.runAutoCorrection(files, compileErrors, (acErr, correctedFiles) => {
                    if (acErr || !correctedFiles) {
                      console.warn(
                        "[Sandbox] Auto-correction failed or timed out:",
                        acErr?.message || "no output",
                      );
                      return callback(null, {
                        status: "compilation_failed",
                        message:
                          "TypeScript compilation failed. Autonomous auto-correction failed to generate a fix.",
                        errors:
                          compileErrors.length > 0
                            ? compileErrors
                            : [
                                "TypeScript compiler produced no readable diagnostics.",
                                "Common causes: file lives outside src/ (tsc config doesn't include it),",
                                "invalid file extension, missing type declarations, or a broken tsconfig.",
                                acErr?.message
                                  ? `Auto-correction stderr: ${acErr.message}`
                                  : "Auto-correction returned no output.",
                              ],
                      });
                    }

                    console.log(
                      "[Sandbox] Re-running sandbox compilation check with auto-corrected files...",
                    );
                    runSandboxCheck(
                      workdir,
                      correctedFiles,
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
                      options,
                    );
                  });
                })
                .catch((acModuleErr) => {
                  console.warn(
                    "[Sandbox] Failed to load auto-correct module:",
                    acModuleErr.message,
                  );
                  return callback(null, {
                    status: "compilation_failed",
                    message: "TypeScript compilation failed. Auto-correction module not available.",
                    errors: compileErrors,
                  });
                });
              return;
            }

            return callback(null, {
              status: "compilation_failed",
              message: "TypeScript compilation failed. Fix the errors below and try again.",
              errors: compileErrors,
            });
          }

          console.log("[Sandbox] Compilation check succeeded!");

          // Step 5.5: Run vitest - fail deploy if tests break
          // UX-fix: admin may explicitly skip tests via {skipTests: true}
          if (options.skipTests) {
            console.log("[Sandbox] Skipping vitest (skipTests=true requested).");
            return callback(null, {
              status: "success",
              message: "TypeScript compiled. Tests skipped by user request. Ready to deploy.",
              warning: "Tests were not run — deploy at your own risk.",
              filesToApply: files,
              dryRun,
            });
          }
          console.log("[Sandbox] Running vitest...");
          execFile(
            "npx",
            ["vitest", "run", "--reporter=dot"],
            { cwd: sandboxDir, timeout: 30000 },
            (testErr, testStdout, testStderr) => {
              if (testErr) {
                const testOutput = `${testStdout}\n${testStderr}`.trim().split("\n").slice(-30);
                console.log("[Sandbox] Tests failed.");
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
              execFile(
                "npx",
                ["vite", "build", "--outDir", path.join(sandboxDir, "dist-check")],
                { cwd: sandboxDir, timeout: 90000 },
                (buildErr, buildStdout, buildStderr) => {
                  if (buildErr) {
                    const out = `${buildStdout || ""}\n${buildStderr || ""}`
                      .trim()
                      .split("\n")
                      .slice(-40);
                    console.log("[Sandbox] vite build failed.");
                    return callback(null, {
                      status: "build_failed",
                      message: "TypeScript + tests passed, but vite build failed.",
                      errors: out,
                    });
                  }
                  console.log("[Sandbox] vite build succeeded!");

                  if (dryRun) {
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

                  try {
                    for (const f of files) {
                      const resolvedDest = resolveInside(activeUiDir, f.path);
                      fs.mkdirSync(path.dirname(resolvedDest), { recursive: true });
                      fs.writeFileSync(resolvedDest, f.content, "utf8");
                    }
                  } catch (e) {
                    logAudit(workdir, userEmail, "SANDBOX_DEPLOY_FAILED", e.message);
                    return callback(
                      new Error(`Failed to deploy files to active codebase: ${e.message}`),
                    );
                  }

                  createGitCheckpoint(activeUiDir, files, (gitErr, commitMessage) => {
                    if (gitErr) {
                      logAudit(
                        workdir,
                        userEmail,
                        "SANDBOX_DEPLOY_WARNING",
                        `Code deployed but Git checkpoint failed: ${gitErr.message}`,
                      );
                      return callback(null, {
                        status: "success",
                        message: "Code successfully deployed, but Git checkpoint failed.",
                        detail: gitErr.message,
                      });
                    }

                    logAudit(
                      workdir,
                      userEmail,
                      "SANDBOX_DEPLOY_SUCCESS",
                      `Code deployed. Git commit: ${commitMessage}`,
                    );
                    callback(null, {
                      status: "success",
                      message:
                        "Pre-flight compilation + tests + vite build succeeded and changes were successfully deployed!",
                      commit: commitMessage,
                    });
                  });
                },
              ); // end vite build
            },
          ); // end vitest
        },
      ); // end tsc
    },
  ); // end biome
}

function createGitCheckpoint(repoDir, files, callback) {
  const modifiedFiles = files.map((f) => f.path).join(", ");
  const now = new Date();
  const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  const msg = `Auto-Improve: Compile success at ${timeStr} (files: ${modifiedFiles})`;

  execFile("git", ["add", "."], { cwd: repoDir, timeout: 10000 }, (err1) => {
    if (err1) return callback(new Error("git add failed"));

    execFile("git", ["commit", "-m", msg], { cwd: repoDir, timeout: 15000 }, (err2) => {
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
    });
  });
}

function copyFolderRecursiveSync(src, dest, excludes = []) {
  if (!fs.existsSync(src)) return;
  const stats = fs.statSync(src);

  if (stats.isDirectory()) {
    const base = path.basename(src);
    if (excludes.includes(base)) return;

    fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach((child) => {
      copyFolderRecursiveSync(path.join(src, child), path.join(dest, child), excludes);
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}
