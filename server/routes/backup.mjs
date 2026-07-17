/**
 * P1.2 — Backup routes
 */
import fs from "node:fs";
import {
  createDbBackup,
  listDbBackups,
  notifyBackupWebhook,
  resolveBackupFile,
  restoreDbBackup,
} from "../backup.mjs";
import { getWorkingDiff, logAudit, readAuditLog } from "../self-improve.mjs";
import { captureServerException } from "../sentry.mjs";

export function handleBackupsList(_req, res, { WORKDIR, isRequestAdmin }) {
  if (!isRequestAdmin) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Admin access required." }));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify(listDbBackups(WORKDIR).map(({ name, bytes, time }) => ({ name, bytes, time }))),
  );
}

export function handleBackupCreate(
  _req,
  res,
  { WORKDIR, userEmail, isRequestAdmin, checkRateLimit },
) {
  if (!isRequestAdmin) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Admin access required." }));
    return;
  }
  if (!checkRateLimit(res)) return;
  try {
    const result = createDbBackup(WORKDIR);
    logAudit(WORKDIR, userEmail, "DB_BACKUP", result.name);
    void notifyBackupWebhook({ name: result.name, bytes: result.bytes, by: userEmail });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "success", name: result.name, bytes: result.bytes }));
  } catch (e) {
    captureServerException(e);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Backup failed", detail: e.message }));
  }
}

export function handleBackupDownload(
  _req,
  res,
  { WORKDIR, userEmail, isRequestAdmin, backupDlMatch },
) {
  if (!isRequestAdmin) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Admin access required." }));
    return;
  }
  const name = decodeURIComponent(backupDlMatch[1]);
  const file = resolveBackupFile(WORKDIR, name);
  if (!file) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Backup not found" }));
    return;
  }
  logAudit(WORKDIR, userEmail, "DB_BACKUP_DOWNLOAD", name);
  res.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${name}"`,
    "Content-Length": fs.statSync(file).size,
  });
  fs.createReadStream(file).pipe(res);
}

export async function handleBackupRestore(
  req,
  res,
  { WORKDIR, userEmail, isRequestAdmin, checkRateLimit },
) {
  if (!isRequestAdmin) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Admin access required." }));
    return;
  }
  if (!checkRateLimit(res)) return;
  try {
    const buf = await readBody(req, MAX_JSON_BODY_BYTES);
    const { name } = JSON.parse(buf.toString("utf8") || "{}");
    if (!name) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Backup filename is required." }));
      return;
    }
    const result = restoreDbBackup(WORKDIR, name);
    logAudit(WORKDIR, userEmail, "DB_BACKUP_RESTORE", name);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Restore failed", detail: e.message }));
  }
}

export function handleAuditLogs(_req, res, { WORKDIR, userEmail, isRequestAdmin, readAuditLog }) {
  if (!userEmail) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }
  if (!isRequestAdmin) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Admin access required" }));
    return;
  }
  try {
    const entries = readAuditLog(WORKDIR, 100);
    const formatted = entries.map((e) => {
      if (e.raw) return e.raw;
      return `[${e.timestamp}] [User: ${e.user}] [Action: ${e.action}] ${e.details || ""}`;
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(formatted.length > 0 ? formatted : ["[System] No audit logs recorded yet."]),
    );
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Failed to read audit logs", detail: e.message }));
  }
}

export async function handleDiff(_req, res, { WORKDIR, isRequestAdmin, getWorkingDiff }) {
  if (!isRequestAdmin) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Admin access required." }));
    return;
  }
  try {
    const result = await getWorkingDiff(WORKDIR);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Failed to read source diff", detail: err.message }));
  }
}

// ===========================================================================
// Route Dispatcher
// ===========================================================================

export async function handleBackupRoute(
  req,
  res,
  { WORKDIR, userEmail, isRequestAdmin, checkRateLimit },
) {
  const urlPath = req.url.split("?")[0];

  if (urlPath === "/api/db/backups" && req.method === "GET") {
    return handleBackupsList(req, res, { WORKDIR, isRequestAdmin });
  }

  if (urlPath === "/api/db/backup" && req.method === "POST") {
    return handleBackupCreate(req, res, { WORKDIR, userEmail, isRequestAdmin, checkRateLimit });
  }

  if (urlPath === "/api/db/backup/restore" && req.method === "POST") {
    return handleBackupRestore(req, res, { WORKDIR, userEmail, isRequestAdmin, checkRateLimit });
  }

  const backupDlMatch = urlPath.match(/^\/api\/db\/backup\/download\/(.+)$/);
  if (backupDlMatch && req.method === "GET") {
    return handleBackupDownload(req, res, { WORKDIR, userEmail, isRequestAdmin, backupDlMatch });
  }

  if (urlPath === "/api/db/audit" && req.method === "GET") {
    return handleAuditLogs(req, res, { WORKDIR, userEmail, isRequestAdmin, readAuditLog });
  }

  if (urlPath === "/api/db/diff" && req.method === "GET") {
    return handleDiff(req, res, { WORKDIR, isRequestAdmin, getWorkingDiff });
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
}
