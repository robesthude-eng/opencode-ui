/**
 * P1.2 — Upload routes
 */
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { MAX_BODY_BYTES, readBody } from "../middleware.mjs";
import { hasRunner, RUNNER_WORKSPACE, RUNNERS_ENABLED } from "../runner.mjs";
import { parseMultipart } from "../upload.mjs";

export async function handleUploadFolder(
  req,
  res,
  { WORKDIR, extractSessionId, checkUploadRateLimit },
) {
  if (!(await checkUploadRateLimit(req, res))) return;
  readBody(req, MAX_BODY_BYTES)
    .then((buffer) => {
      const contentType = req.headers["content-type"] || "";
      const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
      if (!boundaryMatch) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing multipart boundary" }));
        return;
      }
      let targetDir = WORKDIR;
      const sessionId = extractSessionId(req);
      if (sessionId) {
        targetDir = path.join(WORKDIR, "sessions", sessionId, "workspace");
      }
      const boundary = boundaryMatch[1] || boundaryMatch[2];
      const parts = parseMultipart(buffer, boundary);
      const errors = [];
      const written = [];
      for (const part of parts) {
        const relPath = part.name.replace(/\\/g, "/").replace(/^\/+/, "");
        if (relPath.includes("..") || relPath.startsWith("/")) {
          errors.push(`Rejected unsafe path: ${relPath}`);
          continue;
        }
        try {
          const fullPath = path.join(targetDir, relPath);
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, part.data);
          written.push(relPath);
        } catch (e) {
          errors.push(`${relPath}: ${e.message}`);
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: errors.length === 0,
          written: written.length,
          errors: errors.length > 0 ? errors : undefined,
        }),
      );
    })
    .catch(() => {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "File too large (max 50 MB)" }));
    });
}

export async function handleUpload(
  req,
  res,
  { WORKDIR, checkUploadRateLimit },
) {
  if (!(await checkUploadRateLimit(req, res))) return;
  let sessionId = "";
  try {
    sessionId =
      new URL(req.url, "http://localhost").searchParams.get("sessionId") || "";
  } catch (e) {
    console.warn("Ignored error:", e);
  }
  if (sessionId && !/^[a-zA-Z0-9_-]+$/.test(sessionId)) sessionId = "";
  readBody(req, MAX_BODY_BYTES)
    .then((buffer) => {
      const contentType = req.headers["content-type"] || "";
      const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
      if (!boundaryMatch) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing multipart boundary" }));
        return;
      }
      const boundary = boundaryMatch[1] || boundaryMatch[2];
      const parts = parseMultipart(buffer, boundary);
      if (parts.length === 0) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No file received" }));
        return;
      }
      const part = parts[0];
      const rawName = part.filename || part.name;
      const safeName = rawName.replace(/[\\/]/g, "_").replace(/^_+/, "");
      if (!safeName || safeName.includes("..")) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid filename" }));
        return;
      }
      let uploadDir;
      let relativePath;
      if (sessionId) {
        uploadDir = path.join(
          WORKDIR,
          "sessions",
          sessionId,
          "workspace",
          "uploads",
        );
        relativePath = `sessions/${sessionId}/workspace/uploads/${safeName}`;
      } else {
        uploadDir = path.join(WORKDIR, "uploads", "_orphan");
        relativePath = `uploads/_orphan/${safeName}`;
      }
      // Абсолютный путь к файлу глазами opencode-инстанса этой сессии:
      // в контейнере-раннере workspace смонтирован как /session/workspace,
      // в legacy-режиме это <WORKDIR>/sessions/<sid>/workspace.
      let agentPath = null;
      if (sessionId) {
        agentPath =
          RUNNERS_ENABLED && hasRunner(sessionId)
            ? `${RUNNER_WORKSPACE}/uploads/${safeName}`
            : path.join(WORKDIR, relativePath);
      }
      fs.mkdirSync(uploadDir, { recursive: true });
      const dest = path.join(uploadDir, safeName);
      fs.writeFileSync(dest, part.data);
      try {
        const globalUploads = path.join(WORKDIR, "uploads");
        fs.mkdirSync(globalUploads, { recursive: true });
        fs.writeFileSync(path.join(globalUploads, safeName), part.data);
      } catch {}
      let entryCount = null;
      const ext = path.extname(safeName).toLowerCase();
      if (ext === ".zip") {
        try {
          const zip = new AdmZip(dest);
          entryCount = zip.getEntries().filter((e) => !e.isDirectory).length;
        } catch (e) {
          console.error(
            `[Upload] Failed to read zip entries for ${safeName}:`,
            e.message,
          );
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          path: relativePath,
          agentPath,
          size: part.data.length,
          entryCount,
        }),
      );
    })
    .catch(() => {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "File too large (max 50 MB)" }));
    });
}
