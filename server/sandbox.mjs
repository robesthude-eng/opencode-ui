import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { fileURLToPath } from "url";
import { logAudit } from "./self-improve.mjs";
import { readBody, checkRateLimit, MAX_JSON_BODY_BYTES } from "./middleware.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function handleSandboxRequest(req, res, WORKDIR, userEmail) {
  if (!checkRateLimit(res)) return;

  const urlPath = req.url.split("?")[0];

  if (urlPath === "/api/sandbox/apply" && req.method === "POST") {
    readBody(req, MAX_JSON_BODY_BYTES).then((buf) => {
      try {
        const { files, dryRun = true } = JSON.parse(buf.toString("utf8") || "{}");
        if (!Array.isArray(files) || files.length === 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing or invalid 'files' array in payload." }));
          return;
        }

        // Security: self-improve sandbox may only touch src/** files
        // Block package.json, server/**, config files, etc. to prevent RCE via npm install
        const ALLOWED_PREFIXES = ["src/"];
        const BLOCKED_EXACT = new Set([
          "package.json", "package-lock.json",
          "vite.config.ts", "tsconfig.json", "tsconfig.node.json", "vitest.config.ts",
          "index.html", "Dockerfile", "railway.json", "server.mjs", "start.sh"
        ]);
        for (const f of files) {
          const p = (f.path || "").replace(/\\/g, "/");
          if (BLOCKED_EXACT.has(p) || p.startsWith("server/") || p.startsWith(".github/")) {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `Sandbox security: editing '${p}' is blocked. Allowed: src/** only.` }));
            return;
          }
          if (!ALLOWED_PREFIXES.some(pref => p.startsWith(pref))) {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `Sandbox security: path '${p}' is outside allowed scope (src/).` }));
            return;
          }
        }

        runSandboxCheck(WORKDIR, files, dryRun, userEmail, (err, result) => {
          if (err) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "error", error: "Internal sandbox error", detail: err.message }));
          } else {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result));
          }
        });
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON payload" }));
      }
    }).catch(() => {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Request body too large" }));
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Sandbox endpoint not found." }));
}

function runSandboxCheck(workdir, files, dryRun, userEmail, callback, attemptsLeft = 2) {
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
    const sandboxNodeModules = path.join(sandboxDir, "node_modules");
    if (fs.existsSync(activeNodeModules)) {
      fs.symlinkSync(activeNodeModules, sandboxNodeModules);
    }
  } catch (e) {
    return callback(new Error(`Failed to symlink node_modules: ${e.message}`));
  }

  for (const f of files) {
    const filePath = path.join(sandboxDir, f.path);
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(sandboxDir)) {
      return callback(new Error(`Security violation: path ${f.path} escapes sandbox.`));
    }
    try {
      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
      fs.writeFileSync(resolvedPath, f.content, "utf8");
    } catch (e) {
      return callback(new Error(`Failed to write file ${f.path} in sandbox: ${e.message}`));
    }
  }

  // Step 4.5: Run Prettier to auto-format files in sandbox
  const filesToFormat = files.map(f => path.join(sandboxDir, f.path));
  console.log("[Sandbox] Auto-formatting files with Prettier...");
  execFile("npx", ["prettier", "--write", ...filesToFormat], { timeout: 15000 }, (prettierErr, prettierStdout, prettierStderr) => {
    if (prettierErr) {
      console.warn("[Sandbox] Prettier formatting warning:", prettierStderr || prettierErr.message);
      // We don't fail compilation for Prettier errors, we just proceed
    } else {
      console.log("[Sandbox] Files successfully formatted!");
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
    execFile("./node_modules/.bin/tsc", ["-b"], { cwd: sandboxDir, timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        const compileErrors = (stdout || stderr || "").trim().split("\n").filter(Boolean);
        console.log("[Sandbox] Compilation check failed.");
        
        if (attemptsLeft > 0) {
          console.log(`[Sandbox] Attempting autonomous self-correction (${3-attemptsLeft+1}/2)...`);
          import("./auto-correct.mjs").then((ac) => {
            ac.runAutoCorrection(files, compileErrors, (acErr, correctedFiles) => {
              if (acErr || !correctedFiles) {
                console.warn("[Sandbox] Auto-correction failed or timed out:", acErr?.message || "no output");
                return callback(null, {
                  status: "compilation_failed",
                  message: "TypeScript compilation failed. Autonomous auto-correction failed to generate a fix.",
                  errors: compileErrors,
                });
              }
              
              console.log("[Sandbox] Re-running sandbox compilation check with auto-corrected files...");
              runSandboxCheck(workdir, correctedFiles, dryRun, userEmail, (retryErr, retryResult) => {
                if (retryErr) return callback(retryErr);
                if (retryResult.status === "success") {
                  retryResult.autoCorrected = true;
                  retryResult.message = "Initial compilation failed, but we automatically corrected the errors in the sandbox and successfully deployed the clean code!";
                }
                callback(null, retryResult);
              }, attemptsLeft - 1);
            });
          }).catch((acModuleErr) => {
            console.warn("[Sandbox] Failed to load auto-correct module:", acModuleErr.message);
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
    console.log("[Sandbox] Running vitest...");
    execFile("npx", ["vitest", "run", "--reporter=dot"], { cwd: sandboxDir, timeout: 30000 }, (testErr, testStdout, testStderr) => {
      if (testErr) {
        const testOutput = (testStdout + "\n" + testStderr).trim().split("\n").slice(-30);
        console.log("[Sandbox] Tests failed.");
        return callback(null, {
          status: "tests_failed",
          message: "TypeScript compiled, but tests failed. Fix failing tests before deploy.",
          errors: testOutput,
        });
      }
      console.log("[Sandbox] Tests passed!");

    if (dryRun) {
      return callback(null, {
        status: "success",
        message: "Pre-flight compilation + tests succeeded! Code is clean and safe to deploy.",
      });
    }

    console.log("[Sandbox] Deploying code from sandbox to active repository...");
    logAudit(workdir, userEmail, "SANDBOX_DEPLOY_START", `Deploying changes for ${files.length} files`);
    
    try {
      for (const f of files) {
        const destPath = path.join(activeUiDir, f.path);
        const resolvedDest = path.resolve(destPath);
        if (!resolvedDest.startsWith(activeUiDir)) {
          return callback(new Error(`Security violation: destination path escapes repository.`));
        }
        fs.mkdirSync(path.dirname(resolvedDest), { recursive: true });
        fs.writeFileSync(resolvedDest, f.content, "utf8");
      }
    } catch (e) {
      logAudit(workdir, userEmail, "SANDBOX_DEPLOY_FAILED", e.message);
      return callback(new Error(`Failed to deploy files to active codebase: ${e.message}`));
    }

    createGitCheckpoint(activeUiDir, files, (gitErr, commitMessage) => {
      if (gitErr) {
        logAudit(workdir, userEmail, "SANDBOX_DEPLOY_WARNING", `Code deployed but Git checkpoint failed: ${gitErr.message}`);
        return callback(null, {
          status: "success",
          message: "Code successfully deployed, but Git checkpoint failed.",
          detail: gitErr.message,
        });
      }

      logAudit(workdir, userEmail, "SANDBOX_DEPLOY_SUCCESS", `Code deployed. Git commit: ${commitMessage}`);
      callback(null, {
        status: "success",
        message: "Pre-flight compilation + tests succeeded and changes were successfully deployed!",
        commit: commitMessage,
      });
    });
    }); // end vitest
  });
});
}

function createGitCheckpoint(repoDir, files, callback) {
  const modifiedFiles = files.map(f => f.path).join(", ");
  const now = new Date();
  const timeStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  const msg = `Auto-Improve: Compile success at ${timeStr} (files: ${modifiedFiles})`;

  execFile("git", ["add", "."], { cwd: repoDir, timeout: 10000 }, (err1) => {
    if (err1) return callback(new Error("git add failed"));

    execFile("git", ["commit", "-m", msg], { cwd: repoDir, timeout: 15000 }, (err2) => {
      if (err2) {
        return callback(err2);
      }
      execFile("git", ["log", "-1", "--format=%h — %s"], { cwd: repoDir, timeout: 10000 }, (err3, commitOut) => {
        callback(null, commitOut?.trim() || msg);
      });
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
