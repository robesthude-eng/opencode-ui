import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { checkRateLimit, MAX_JSON_BODY_BYTES, readBody } from "./middleware.mjs";
import { logAudit } from "./self-improve.mjs";

export function handleASTModifyRequest(req, res, WORKDIR, userEmail) {
  if (!checkRateLimit(res)) return;

  const urlPath = req.url.split("?")[0];

  if (urlPath === "/api/sandbox/ast-modify" && req.method === "POST") {
    readBody(req, MAX_JSON_BODY_BYTES)
      .then((buf) => {
        try {
          const { filePath, operations, dryRun = true } = JSON.parse(buf.toString("utf8") || "{}");
          if (!filePath || !Array.isArray(operations) || operations.length === 0) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: "Missing or invalid 'filePath' or 'operations' array in payload.",
              }),
            );
            return;
          }

          const activeUiDir = path.join(WORKDIR, "opencode-ui");
          const realFilePath = path.join(activeUiDir, filePath);
          const resolvedPath = path.resolve(realFilePath);

          // Security check
          if (!resolvedPath.startsWith(activeUiDir)) {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Security violation: File path escapes repository." }));
            return;
          }

          if (!fs.existsSync(resolvedPath)) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `File not found: ${filePath}` }));
            return;
          }

          // Apply AST operations
          let content = fs.readFileSync(resolvedPath, "utf8");
          console.log(`[AST] Applying ${operations.length} AST operations to ${filePath}...`);

          try {
            for (const op of operations) {
              if (op.action === "addImport") {
                content = addImport(content, op.module, op.specifiers || [], op.default || null);
              } else if (op.action === "addRoute") {
                content = addRoute(content, op.method, op.route, op.handlerCode);
              } else {
                throw new Error(`Unsupported AST action: ${op.action}`);
              }
            }

            // Verify syntactical validity by parsing the resulting code
            const sourceFile = ts.createSourceFile(
              "temp.ts",
              content,
              ts.ScriptTarget.Latest,
              true,
            );
            const diagnostics = sourceFile.parseDiagnostics || [];
            if (diagnostics.length > 0) {
              const firstErr = diagnostics[0];
              throw new Error(
                `Modified code has syntax errors: ${firstErr.messageText} at character ${firstErr.start}`,
              );
            }

            // Format code using Prettier (if available)
            import("./sandbox.mjs").then((_sb) => {
              // Since sandbox has a format function or runs prettier, let's run a formatting pass in the sandbox tmp dir
              const sandboxDir = "/tmp/opencode-ui-sandbox-ast";
              if (!fs.existsSync(sandboxDir)) {
                fs.mkdirSync(sandboxDir, { recursive: true });
              }
              const tmpFilePath = path.join(sandboxDir, path.basename(filePath));
              fs.writeFileSync(tmpFilePath, content, "utf8");

              import("node:child_process").then(({ execFile }) => {
                execFile(
                  "npx",
                  ["prettier", "--write", tmpFilePath],
                  { timeout: 10000 },
                  (prettierErr) => {
                    if (!prettierErr && fs.existsSync(tmpFilePath)) {
                      content = fs.readFileSync(tmpFilePath, "utf8");
                    }

                    if (dryRun) {
                      res.writeHead(200, { "Content-Type": "application/json" });
                      res.end(
                        JSON.stringify({
                          status: "success",
                          message:
                            "AST modification check succeeded! Code is clean and syntactically correct.",
                          content: content,
                        }),
                      );
                    } else {
                      // Write back to the active repository
                      logAudit(
                        WORKDIR,
                        userEmail,
                        "AST_MODIFY_DEPLOY_START",
                        `Modifying ${filePath} via AST`,
                      );
                      fs.writeFileSync(resolvedPath, content, "utf8");

                      // Auto Git Checkpoint
                      createGitCheckpoint(activeUiDir, filePath, (gitErr, commitMessage) => {
                        if (gitErr) {
                          logAudit(
                            WORKDIR,
                            userEmail,
                            "AST_MODIFY_DEPLOY_WARNING",
                            `AST changes applied to ${filePath} but Git commit failed: ${gitErr.message}`,
                          );
                          res.writeHead(200, { "Content-Type": "application/json" });
                          res.end(
                            JSON.stringify({
                              status: "success",
                              message:
                                "AST changes deployed successfully, but Git checkpoint failed.",
                            }),
                          );
                        } else {
                          logAudit(
                            WORKDIR,
                            userEmail,
                            "AST_MODIFY_DEPLOY_SUCCESS",
                            `AST changes deployed to ${filePath}. Commit: ${commitMessage}`,
                          );
                          res.writeHead(200, { "Content-Type": "application/json" });
                          res.end(
                            JSON.stringify({
                              status: "success",
                              message: "AST changes deployed successfully!",
                              commit: commitMessage,
                            }),
                          );
                        }
                      });
                    }
                  },
                );
              });
            });
          } catch (opErr) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                status: "error",
                error: "AST operation failed",
                detail: opErr.message,
              }),
            );
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
  res.end(JSON.stringify({ error: "AST sandbox endpoint not found." }));
}

/**
 * Semantically add or merge an ES6 import statement.
 */
function addImport(sourceText, moduleSpecifier, namedImports = [], defaultImport = null) {
  const sourceFile = ts.createSourceFile("temp.ts", sourceText, ts.ScriptTarget.Latest, true);

  const imports = [];
  sourceFile.forEachChild((node) => {
    if (ts.isImportDeclaration(node)) {
      imports.push(node);
    }
  });

  const existingImport = imports.find((imp) => {
    if (ts.isStringLiteral(imp.moduleSpecifier)) {
      return imp.moduleSpecifier.text === moduleSpecifier;
    }
    return false;
  });

  if (existingImport) {
    const currentNamed = [];
    if (
      existingImport.importClause?.namedBindings &&
      ts.isNamedImports(existingImport.importClause.namedBindings)
    ) {
      existingImport.importClause.namedBindings.elements.forEach((el) => {
        currentNamed.push(el.name.text);
      });
    }

    const toAdd = namedImports.filter((name) => !currentNamed.includes(name));
    if (
      toAdd.length === 0 &&
      (!defaultImport ||
        (existingImport.importClause?.name &&
          existingImport.importClause.name.text === defaultImport))
    ) {
      return sourceText;
    }

    const start = existingImport.getStart(sourceFile);
    const end = existingImport.getEnd();

    let newImportStr = "import ";
    if (defaultImport || existingImport.importClause?.name) {
      const defName = defaultImport || existingImport.importClause.name.text;
      newImportStr += defName;
      if (toAdd.length > 0 || currentNamed.length > 0) {
        newImportStr += ", ";
      }
    }

    if (toAdd.length > 0 || currentNamed.length > 0) {
      const allNamed = [...currentNamed, ...toAdd];
      newImportStr += `{ ${allNamed.join(", ")} }`;
    }
    newImportStr += ` from "${moduleSpecifier}";`;

    return sourceText.slice(0, start) + newImportStr + sourceText.slice(end);
  } else {
    let newImportStr = "import ";
    if (defaultImport) {
      newImportStr += defaultImport;
      if (namedImports.length > 0) newImportStr += ", ";
    }
    if (namedImports.length > 0) {
      newImportStr += `{ ${namedImports.join(", ")} }`;
    }
    newImportStr += ` from "${moduleSpecifier}";\n`;

    if (imports.length > 0) {
      const lastImport = imports[imports.length - 1];
      const end = lastImport.getEnd();
      return `${sourceText.slice(0, end)}\n${newImportStr}${sourceText.slice(end)}`;
    } else {
      return `${newImportStr}\n${sourceText}`;
    }
  }
}

/**
 * Pluggably insert an HTTP server route in the server index.mjs file.
 */
function addRoute(sourceText, method, routePath, handlerCode) {
  const methodUpper = method.toUpperCase();
  const _routeTrigger = `urlPath === "${routePath}"`;

  // Find where SELF_IMPROVE_ROUTES is declared or where routes are placed
  const index = sourceText.indexOf("// Self-improvement endpoints — ADMIN ONLY.");
  if (index === -1) {
    throw new Error(
      "Could not find the hook location '// Self-improvement endpoints — ADMIN ONLY.' in server code.",
    );
  }

  // Construct our clean pluggable route handler
  const routeBlock = `
  // Pluggable AST-inserted Route
  if (urlPath === "${routePath}" && req.method === "${methodUpper}") {
    ${handlerCode.trim()}
    return;
  }
  
`;

  return sourceText.slice(0, index) + routeBlock + sourceText.slice(index);
}

function createGitCheckpoint(repoDir, filePath, callback) {
  import("node:child_process").then(({ execFile }) => {
    const now = new Date();
    const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    const msg = `AST-Modify: Successfully modified ${filePath} at ${timeStr}`;

    execFile("git", ["add", filePath], { cwd: repoDir, timeout: 10000 }, (err1) => {
      if (err1) return callback(new Error("git add failed"));

      execFile("git", ["commit", "-m", msg], { cwd: repoDir, timeout: 15000 }, (err2) => {
        if (err2) return callback(err2);
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
  });
}
