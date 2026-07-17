/**
 * Isolation helpers — pure functions for per-session workspace isolation.
 * Extracted as part of P0.1 contract tests (ARCHITECTURE_REFACTOR_PLAN).
 *
 * Invariants:
 * 1. Every per-session OpenCode request preserves ?directory= for that session workspace.
 * 2. Global routes and requests without a session ID never receive directory=.
 * 3. Temp optimistic IDs tmp_* are never valid session IDs.
 */

import path from "node:path";

const SESSION_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

export function isValidSessionId(sessionId) {
  if (typeof sessionId !== "string") return false;
  if (sessionId.startsWith("tmp_")) return false;
  return SESSION_ID_RE.test(sessionId);
}

/**
 * Returns the isolated workspace directory for a session.
 * Example: /app/workspace/sessions/ses_abc123/workspace
 */
export function getSessionWorkspace(sessionId, workdir) {
  if (!isValidSessionId(sessionId)) {
    throw new Error(`Invalid session ID: ${sessionId}`);
  }
  const base = workdir || process.env.OPENCODE_WORKDIR || "/app/workspace";
  return path.join(base, "sessions", sessionId, "workspace");
}

/**
 * Global routes that must NEVER receive ?directory=
 * These are auth, config, health, self-improve, etc.
 */
const GLOBAL_ROUTE_PREFIXES = [
  "/api/config/",
  "/api/provider",
  "/api/auth/",
  "/api/global/",
  "/api/self-improve/",
  "/api/sandbox/",
  "/api/rebuild",
  "/api/settings/",
  "/auth/",
  "/global/",
  "/health",
];

export function isGlobalRoute(urlPath) {
  if (typeof urlPath !== "string") return true;
  const pathname = urlPath.split("?")[0];
  return GLOBAL_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

export function extractSessionId(req) {
  const urlPath = req.url.split("?")[0];
  const m = urlPath.match(/^\/api\/session\/([^/?]+)/);
  if (m) {
    const sid = decodeURIComponent(m[1]);
    if (isValidSessionId(sid)) return sid;
  }
  try {
    const qs = new URL(req.url, "http://localhost").searchParams.get("sessionId");
    if (qs && isValidSessionId(qs)) return qs;
  } catch (e) { console.warn("Ignored error:", e.message); }
  const hdr = req.headers["x-session-id"];
  if (hdr && isValidSessionId(hdr)) return hdr;
  return null;
}

export function checkSessionOwnership(sessionId, userEmail, res, ownersFile, loadJson) {
  const owners = loadJson(ownersFile, {});
  if (owners[sessionId] && userEmail && owners[sessionId] !== userEmail) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Access denied" }));
    return false;
  }
  return true;
}

/**
 * Per-session routes that MUST receive ?directory=
 * Any route containing /session/{id} where id looks like ses_* or at least valid-ish
 */
export function isPerSessionRoute(urlPath) {
  if (typeof urlPath !== "string") return false;
  const pathname = urlPath.split("?")[0];
  // Match /session/ses_xxx or /api/session/ses_xxx or /session/:id/message etc
  return /\/session\/([a-zA-Z0-9_-]+)/.test(pathname);
}

/**
 * Extract session ID from URL path if present.
 * Returns null if not found or invalid.
 */
export function extractSessionIdFromPath(urlPath) {
  if (typeof urlPath !== "string") return null;
  const m = urlPath.match(/\/session\/([a-zA-Z0-9_-]+)/);
  if (!m) return null;
  const id = m[1];
  return isValidSessionId(id) ? id : null;
}

/**
 * Resolve target URL for OpenCode system instance.
 * Ensures per-session requests have ?directory= and global requests don't.
 *
 * @param {string} originalUrl - incoming URL from client (e.g. /api/session/ses_123/message)
 * @param {string|null} sessionId - extracted session ID or null
 * @param {string} workdir - OPENCODE_WORKDIR
 * @returns {string} url to proxy to OpenCode (e.g. /session/ses_123/message?directory=...)
 */
export function resolveTargetUrl(originalUrl, sessionId, workdir) {
  if (typeof originalUrl !== "string") originalUrl = "/";
  const [pathPart, queryPart] = originalUrl.split("?");
  const searchParams = new URLSearchParams(queryPart || "");

  // Global routes: strip any directory param that might have been smuggled
  if (!sessionId || isGlobalRoute(originalUrl)) {
    searchParams.delete("directory");
    searchParams.delete("workspace");
    const qs = searchParams.toString();
    return qs ? `${pathPart}?${qs}` : pathPart;
  }

  // Per-session: ensure directory is the isolated workspace
  if (!isValidSessionId(sessionId)) {
    // Invalid session IDs (tmp_) should not be proxied – caller should handle 410
    searchParams.delete("directory");
    const qs = searchParams.toString();
    return qs ? `${pathPart}?${qs}` : pathPart;
  }

  const workspace = getSessionWorkspace(sessionId, workdir);
  searchParams.set("directory", workspace);
  // Preserve other params (limit, before, etc.) but ensure directory is set
  const qs = searchParams.toString();
  return `${pathPart}?${qs}`;
}

/**
 * Build the canonical session workspace from workdir + sessionId.
 * Also validates that workspace does not escape workdir (path traversal guard).
 */
export function buildSafeWorkspacePath(sessionId, workdir) {
  const workspace = getSessionWorkspace(sessionId, workdir);
  const base = path.resolve(workdir || "/app/workspace");
  const resolved = path.resolve(workspace);
  if (!resolved.startsWith(base)) {
    throw new Error("Workspace escapes project directory");
  }
  return resolved;
}
