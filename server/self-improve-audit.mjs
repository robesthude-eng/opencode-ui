/**
 * Релиз 5 (Пакет 3): аудит-лог вынесен из self-improve.mjs без изменений логики.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * Write audit log for administrative actions.
 * Format: JSON Lines (one JSON object per line) for easy parsing.
 * Rotation: when audit.log exceeds 1MB, rename to audit.log.1 and start fresh.
 * Keeps at most 1 rotated file (2MB total max).
 */
const AUDIT_MAX_BYTES = 1024 * 1024; // 1MB
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
        try {
          fs.unlinkSync(rotatedFile);
        } catch {
          /* ignore */
        }
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
          entries.push({
            raw: line,
            timestamp: "",
            user: "",
            action: "",
            details: "",
          });
        }
      }
    }

    // Sort by timestamp descending (most recent first), take last maxEntries
    entries.sort((a, b) =>
      (b.timestamp || "").localeCompare(a.timestamp || ""),
    );
    return entries.slice(0, maxEntries);
  } catch {
    return [];
  }
}
