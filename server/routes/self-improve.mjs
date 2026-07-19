/**
 * P1.2 — Self-improve routes extracted
 * All handlers preserve original gate order and logic, no body rewrites.
 * P1.3 — v2 transaction endpoints integrated
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  enableAutoMerge,
  openPullRequest,
  readRemoteInfo,
} from "../github-pr.mjs";
import { logger } from "../logger.mjs";
import {
  checkRateLimit,
  MAX_JSON_BODY_BYTES,
  readBody,
} from "../middleware.mjs";
import { getTestStatus } from "../sandbox.mjs";
import {
  createCheckpoint,
  ensureSiInternalToken,
  getSelfImproveSessionId,
  getUiDir,
  instantRollbackDist,
  isSelfImproveEnabled,
  listCheckpoints,
  listDistSnapshots,
  logAudit,
  rebuildUi,
  refreshSelfImproveWorkspace,
  releaseBuildLock,
  resetUi,
  rollbackToCommit,
  setSelfImproveSessionId,
  syncUiSource,
  toggleSelfImprove,
  tryAcquireBuildLock,
} from "../self-improve.mjs";

const execFileP = promisify(execFile);

import { handleCreatePr, handlePrs } from "./self-improve-pr.mjs";
import {
  handleProposalConfirm,
  handleProposalCreate,
  handleProposalExecute,
  handleProposalGet,
  handleProposalsList,
} from "./self-improve-proposals.mjs";

// Ре-экспорт для обратной совместимости (тесты и внешние импорты).
export {
  handleCreatePr,
  handleProposalConfirm,
  handleProposalCreate,
  handleProposalExecute,
  handleProposalGet,
  handleProposalsList,
  handlePrs,
};

export async function handleSettingsSelfImproveGet(
  _req,
  res,
  { WORKDIR, isRequestAdmin, getSelfImproveSessionId },
) {
  const enabled = isSelfImproveEnabled(WORKDIR);
  const sessionId = getSelfImproveSessionId(WORKDIR);
  const testInfo = getTestStatus(WORKDIR);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      enabled,
      sessionId,
      canWrite: !!isRequestAdmin,
      testStatus: testInfo.status,
      testErrors: testInfo.errors,
    }),
  );
}

export async function handleSettingsSelfImprovePost(
  req,
  res,
  { WORKDIR, userEmail },
) {
  try {
    const buf = await readBody(req, MAX_JSON_BODY_BYTES);
    const { enabled } = JSON.parse(buf.toString("utf8") || "{}");
    const wasEnabled = isSelfImproveEnabled(WORKDIR);
    toggleSelfImprove(WORKDIR, enabled);
    logAudit(
      WORKDIR,
      userEmail,
      "TOGGLE_SELF_IMPROVE",
      `Enabled: ${!!enabled}`,
    );
    let sync = null;
    if (enabled && !wasEnabled) {
      try {
        sync = await syncUiSource(WORKDIR);
      } catch (se) {
        logger.error(
          "[self-improve] resync on enable failed:",
          se?.message || se,
        );
        sync = { source: "error", githubOk: false };
      }
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "success", enabled: !!enabled, sync }));
  } catch (_e) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON" }));
  }
}

export async function handleSettingsSelfImproveSessionPost(
  req,
  res,
  { WORKDIR, userEmail, isRequestAdmin },
) {
  if (!isSelfImproveEnabled(WORKDIR)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Self-Improvement Mode is disabled on the server.",
      }),
    );
    return;
  }
  if (!isRequestAdmin) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Admin access required." }));
    return;
  }
  try {
    const buf = await readBody(req, MAX_JSON_BODY_BYTES);
    const { id } = JSON.parse(buf.toString("utf8") || "{}");
    if (id) {
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid session id." }));
        return;
      }
      const previousId = getSelfImproveSessionId(WORKDIR);
      if (previousId !== id) {
        refreshSelfImproveWorkspace(WORKDIR, id);
      } else {
        // Re-selecting the same SI chat must preserve its workspace and token.
        ensureSiInternalToken(WORKDIR, id);
      }
      setSelfImproveSessionId(WORKDIR, id);
      logAudit(WORKDIR, userEmail, "SELF_IMPROVE_SESSION_SET", `session=${id}`);
    } else {
      setSelfImproveSessionId(WORKDIR, null);
      logAudit(WORKDIR, userEmail, "SELF_IMPROVE_SESSION_CLEAR", "");
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "success", id: id || null }));
  } catch (e) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON", detail: e.message }));
  }
}

export async function handleSelfImproveResync(
  req,
  res,
  { WORKDIR, userEmail },
) {
  if (!tryAcquireBuildLock()) {
    res.writeHead(409, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "resync_locked",
        message: "Another build/resync/rollback is currently running.",
      }),
    );
    return;
  }
  try {
    const _buf = await readBody(req, MAX_JSON_BODY_BYTES);
    if (!isSelfImproveEnabled(WORKDIR)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Self-Improvement Mode is disabled on the server.",
        }),
      );
      return;
    }
    const result = await syncUiSource(WORKDIR);
    logAudit(
      WORKDIR,
      userEmail,
      "SELF_IMPROVE_RESYNC",
      `source=${result.source}`,
    );
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, ...result }));
  } catch (se) {
    logger.error("[self-improve] resync failed:", se?.message || se);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "resync failed",
        detail: se?.message || String(se),
      }),
    );
  } finally {
    releaseBuildLock();
  }
}

export async function handleRebuild(
  _req,
  res,
  { WORKDIR, userEmail, checkRateLimit },
) {
  if (!isSelfImproveEnabled(WORKDIR)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Self-Improvement Mode is disabled on the server.",
      }),
    );
    return;
  }
  if (!(await checkRateLimit(res))) return;
  if (!tryAcquireBuildLock()) {
    res.writeHead(409, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Another build/reset/rollback is already in progress.",
      }),
    );
    return;
  }
  logAudit(WORKDIR, userEmail, "REBUILD_UI_START", "Starting UI build process");
  try {
    const stdout = await rebuildUi(WORKDIR);
    logAudit(WORKDIR, userEmail, "REBUILD_UI_SUCCESS", "UI built successfully");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "success", stdout }));
  } catch (err) {
    logAudit(WORKDIR, userEmail, "REBUILD_UI_FAILED", err.message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Rebuild failed", detail: err.message }));
  } finally {
    releaseBuildLock();
  }
}

export async function handleResetUi(
  _req,
  res,
  { WORKDIR, userEmail, checkRateLimit },
) {
  if (!isSelfImproveEnabled(WORKDIR)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Self-Improvement Mode is disabled on the server.",
      }),
    );
    return;
  }
  if (!(await checkRateLimit(res))) return;
  if (!tryAcquireBuildLock()) {
    res.writeHead(409, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Another build/reset/rollback is already in progress.",
      }),
    );
    return;
  }
  logAudit(WORKDIR, userEmail, "RESET_UI_START", "Starting UI factory reset");
  try {
    const stdout = await resetUi(WORKDIR);
    logAudit(
      WORKDIR,
      userEmail,
      "RESET_UI_SUCCESS",
      "UI reset and rebuilt successfully",
    );
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "success", stdout }));
  } catch (err) {
    logAudit(WORKDIR, userEmail, "RESET_UI_FAILED", err.message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Reset failed", detail: err.message }));
  } finally {
    releaseBuildLock();
  }
}

export async function handleCheckpoint(_req, res, { WORKDIR, userEmail }) {
  if (!isSelfImproveEnabled(WORKDIR)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Self-Improvement Mode is disabled on the server.",
      }),
    );
    return;
  }
  try {
    const result = await createCheckpoint(WORKDIR);
    logAudit(
      WORKDIR,
      userEmail,
      "CHECKPOINT_SUCCESS",
      `Commit: ${result.commit || ""}`,
    );
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (err) {
    logAudit(WORKDIR, userEmail, "CHECKPOINT_FAILED", err.message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Failed to create checkpoint",
        detail: err.message,
      }),
    );
  }
}

export async function handleCheckpoints(_req, res, { WORKDIR }) {
  try {
    const commits = await listCheckpoints(WORKDIR);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(commits));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Failed to list checkpoints" }));
  }
}

export function handleDistSnapshots(_req, res, { isRequestAdmin }) {
  if (!isRequestAdmin) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Admin access required." }));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(listDistSnapshots()));
}

export async function handleInstantRollback(
  req,
  res,
  { WORKDIR, userEmail, isRequestAdmin, checkRateLimit, readBody },
) {
  if (!isRequestAdmin) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Admin access required." }));
    return;
  }
  if (!isSelfImproveEnabled(WORKDIR)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Self-Improvement Mode is disabled on the server.",
      }),
    );
    return;
  }
  if (!(await checkRateLimit(res))) return;
  readBody(req, MAX_JSON_BODY_BYTES)
    .then((buf) => {
      try {
        const body = JSON.parse(buf.toString("utf8") || "{}");
        const index = Number.isFinite(body.index) ? body.index : 0;
        logAudit(WORKDIR, userEmail, "DIST_INSTANT_ROLLBACK", `index=${index}`);
        const result = instantRollbackDist(index);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "success", ...result }));
      } catch (e) {
        const msg = String(e?.message || e);
        const isUserError =
          /only one snapshot|no (older )?(dist )?snapshot|invalid index|out of range|nothing to roll/i.test(
            msg,
          );
        res.writeHead(isUserError ? 400 : 500, {
          "Content-Type": "application/json",
        });
        res.end(
          JSON.stringify({
            error: isUserError
              ? "Nothing to roll back to"
              : "Instant rollback failed",
            detail: msg,
          }),
        );
      }
    })
    .catch(() => {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Request body too large" }));
    });
}

export async function handleRollback(
  req,
  res,
  { WORKDIR, userEmail, checkRateLimit, readBody },
) {
  if (!isSelfImproveEnabled(WORKDIR)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Self-Improvement Mode is disabled on the server.",
      }),
    );
    return;
  }
  if (!(await checkRateLimit(res))) return;
  if (!tryAcquireBuildLock()) {
    res.writeHead(409, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Another build/reset/rollback is already in progress.",
      }),
    );
    return;
  }
  try {
    const buf = await readBody(req, MAX_JSON_BODY_BYTES);
    let body;
    try {
      body = JSON.parse(buf.toString("utf8") || "{}");
    } catch (_e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }
    const { hash } = body;
    if (!hash || !/^[a-fA-F0-9]{4,40}$/.test(hash)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid commit hash format." }));
      return;
    }
    logAudit(
      WORKDIR,
      userEmail,
      "ROLLBACK_START",
      `Rolling back UI to commit: ${hash}`,
    );
    try {
      const result = await rollbackToCommit(WORKDIR, hash);
      logAudit(
        WORKDIR,
        userEmail,
        "ROLLBACK_SUCCESS",
        `Successfully rolled back UI to commit: ${hash}`,
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "success", message: result.message }));
    } catch (err) {
      logAudit(
        WORKDIR,
        userEmail,
        "ROLLBACK_FAILED",
        `Hash ${hash}: ${err.message}`,
      );
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: "Rollback failed", detail: err.message }),
      );
    }
  } catch {
    res.writeHead(413, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Request body too large" }));
  } finally {
    releaseBuildLock();
  }
}

// ===========================================================================
// P1.3 — v2 transaction endpoints
// ===========================================================================

// ===========================================================================
// Route Dispatcher
// ===========================================================================

export async function handleSelfImproveRoute(
  req,
  res,
  { WORKDIR, userEmail, isRequestAdmin, isInternalRequest = false },
) {
  const urlPath = req.url.split("?")[0];

  // ---------------------------------------------------------------------
  // Central admin gate (invariant: self-improve routes are ADMIN ONLY).
  // The only exception is the read-only settings status, which the UI needs
  // to render the toggle state for every user (it returns canWrite=false
  // for non-admins). Everything else — toggle, resync, create-pr, PR list,
  // rebuild, reset, checkpoints, rollbacks, proposals — mutates the live
  // project or exposes its history and must be 403 for non-admins.
  // Individual handlers keep their own checks as defense in depth.
  // ---------------------------------------------------------------------
  const isPublicRead =
    urlPath === "/api/settings/self-improve" && req.method === "GET";
  if (!isPublicRead && !isRequestAdmin && !isInternalRequest) {
    logAudit(WORKDIR, userEmail, "SI_ADMIN_DENIED", `${req.method} ${urlPath}`);
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Admin access required." }));
    return;
  }

  // 1. Settings GET & POST
  if (urlPath === "/api/settings/self-improve") {
    if (req.method === "GET") {
      return handleSettingsSelfImproveGet(req, res, {
        WORKDIR,
        isRequestAdmin,
        getSelfImproveSessionId,
      });
    }
    if (req.method === "POST") {
      return handleSettingsSelfImprovePost(req, res, { WORKDIR, userEmail });
    }
  }

  // 2. Settings Session POST
  if (
    urlPath === "/api/settings/self-improve/session" &&
    req.method === "POST"
  ) {
    return handleSettingsSelfImproveSessionPost(req, res, {
      WORKDIR,
      userEmail,
      isRequestAdmin,
    });
  }

  // 3. Resync POST
  if (urlPath === "/api/self-improve/resync" && req.method === "POST") {
    return handleSelfImproveResync(req, res, { WORKDIR, userEmail });
  }

  // 4. Create PR POST
  if (urlPath === "/api/self-improve/create-pr" && req.method === "POST") {
    return handleCreatePr(req, res, {
      WORKDIR,
      userEmail,
      checkRateLimit,
      openPullRequest,
      enableAutoMerge,
      getUiDir,
      logAudit,
      logger,
    });
  }

  // 5. PRs GET
  if (urlPath === "/api/self-improve/prs" && req.method === "GET") {
    return handlePrs(req, res, { WORKDIR, isRequestAdmin, readRemoteInfo });
  }

  // 6. Rebuild POST
  if (urlPath === "/api/rebuild" && req.method === "POST") {
    return handleRebuild(req, res, { WORKDIR, userEmail, checkRateLimit });
  }

  // 7. Reset UI POST
  if (urlPath === "/api/reset-ui" && req.method === "POST") {
    return handleResetUi(req, res, { WORKDIR, userEmail, checkRateLimit });
  }

  // 8. Checkpoint POST
  if (urlPath === "/api/git/checkpoint" && req.method === "POST") {
    return handleCheckpoint(req, res, { WORKDIR, userEmail });
  }

  // 9. Checkpoints GET
  if (urlPath === "/api/git/checkpoints" && req.method === "GET") {
    return handleCheckpoints(req, res, { WORKDIR });
  }

  // 10. Dist Snapshots GET
  if (urlPath === "/api/dist/snapshots" && req.method === "GET") {
    return handleDistSnapshots(req, res, { isRequestAdmin });
  }

  // 11. Instant Rollback POST
  if (urlPath === "/api/dist/rollback" && req.method === "POST") {
    return handleInstantRollback(req, res, {
      WORKDIR,
      userEmail,
      isRequestAdmin,
      checkRateLimit,
      readBody,
    });
  }

  // 12. Rollback POST
  if (urlPath === "/api/git/rollback" && req.method === "POST") {
    return handleRollback(req, res, {
      WORKDIR,
      userEmail,
      checkRateLimit,
      readBody,
    });
  }

  // 13. Proposals list & create
  if (urlPath === "/api/self-improve/proposals") {
    if (req.method === "GET") {
      return handleProposalsList(req, res, { WORKDIR });
    }
    if (req.method === "POST") {
      return handleProposalCreate(req, res, { WORKDIR, userEmail });
    }
  }

  // 14. Proposals get, confirm & execute
  const proposalMatch = urlPath.match(
    /^\/api\/self-improve\/proposals\/([^/]+)(?:\/(confirm|execute))?$/,
  );
  if (proposalMatch) {
    const proposalId = proposalMatch[1];
    const action = proposalMatch[2];

    if (!action && req.method === "GET") {
      return handleProposalGet(req, res, { WORKDIR, proposalId });
    }
    if (action === "confirm" && req.method === "POST") {
      return handleProposalConfirm(req, res, {
        WORKDIR,
        proposalId,
        userEmail,
        isRequestAdmin,
      });
    }
    if (action === "execute" && req.method === "POST") {
      return handleProposalExecute(req, res, {
        WORKDIR,
        proposalId,
        userEmail,
        isRequestAdmin,
        checkRateLimit,
      });
    }
  }

  // If no route matched
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
}
