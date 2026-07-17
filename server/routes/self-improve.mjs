/**
 * P1.2 — Self-improve routes extracted
 * All handlers preserve original gate order and logic, no body rewrites.
 * P1.3 — v2 transaction endpoints integrated
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
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
import {
  getTestStatus,
  normalizeSandboxPath,
  resolveInside,
} from "../sandbox.mjs";
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
  promoteDistSnapshot,
  rebuildUi,
  refreshSelfImproveWorkspace,
  releaseBuildLock,
  resetUi,
  restoreLatestDist,
  rollbackToCommit,
  setSelfImproveSessionId,
  syncUiSource,
  toggleSelfImprove,
  tryAcquireBuildLock,
} from "../self-improve.mjs";
import {
  confirmProposal,
  createProposal,
  executeProposalTransaction,
  getProposal,
  listProposals,
} from "../self-improve-v2.mjs";

const execFileP = promisify(execFile);

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

export async function handleCreatePr(
  req,
  res,
  {
    WORKDIR,
    userEmail,
    checkRateLimit,
    openPullRequest,
    enableAutoMerge,
    getUiDir,
    logAudit,
    logger,
  },
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
        error: "Another build/PR/rollback is in progress. Wait and retry.",
      }),
    );
    return;
  }
  try {
    const buf = await readBody(req, MAX_JSON_BODY_BYTES);
    const {
      files,
      title,
      body,
      // P0-fix (безопасность): auto-merge больше НЕ включён по умолчанию —
      // иначе self-improve агент мог сам замерджить и задеплоить код
      // на прод без человеческого ревью. Мердж только по явному
      // autoMerge: true в теле запроса (осознанный клик человека).
      autoMerge = false,
    } = JSON.parse(buf.toString("utf8") || "{}");
    if (!Array.isArray(files) || files.length === 0) {
      releaseBuildLock();
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "files array required" }));
      return;
    }
    if (typeof title !== "string" || !title.trim()) {
      releaseBuildLock();
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "title (string) required" }));
      return;
    }
    const uiDir = getUiDir(WORKDIR);
    logAudit(
      WORKDIR,
      userEmail,
      "SI_CREATE_PR_START",
      `title="${title.slice(0, 60)}" files=${files.length}`,
    );
    const pr = await openPullRequest({ uiDir, files, title, body });
    logAudit(
      WORKDIR,
      userEmail,
      "SI_CREATE_PR_OK",
      `PR #${pr.number} ${pr.url}`,
    );
    let autoMergeResult = { enabled: false, requested: !!autoMerge };
    if (autoMerge) {
      autoMergeResult = {
        ...(await enableAutoMerge({ uiDir, prNumber: pr.number })),
        requested: true,
      };
      if (autoMergeResult.enabled)
        logAudit(
          WORKDIR,
          userEmail,
          "SI_AUTO_MERGE_ENABLED",
          `PR #${pr.number}`,
        );
    }
    releaseBuildLock();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ status: "success", ...pr, autoMerge: autoMergeResult }),
    );
  } catch (e) {
    releaseBuildLock();
    logAudit(WORKDIR, userEmail, "SI_CREATE_PR_FAIL", String(e?.message || e));
    logger.error("[create-pr] error:", e?.message || e);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "create-pr failed",
        detail: String(e?.message || e),
      }),
    );
  }
}

export async function handlePrs(
  req,
  res,
  { WORKDIR, isRequestAdmin, readRemoteInfo },
) {
  if (!isRequestAdmin) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Admin access required." }));
    return;
  }
  if (!isSelfImproveEnabled(WORKDIR)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Self-Improvement Mode is disabled." }));
    return;
  }
  try {
    const uiDir = getUiDir(WORKDIR);
    const { token, owner, repo } = await readRemoteInfo(uiDir);
    if (!token) throw new Error("No GITHUB_TOKEN available");
    const parsed = new URL(req.url, "http://localhost");
    const state = parsed.searchParams.get("state") || "all";
    const list = await new Promise((resolve, reject) => {
      const rq = https.request(
        {
          hostname: "api.github.com",
          port: 443,
          path: `/repos/${owner}/${repo}/pulls?state=${state}&per_page=30&sort=created&direction=desc`,
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "opencode-ui-self-improve/1.0",
          },
        },
        (rs) => {
          let b = "";
          rs.on("data", (c) => (b += c));
          rs.on("end", () => {
            try {
              resolve(JSON.parse(b));
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      rq.on("error", reject);
      rq.setTimeout(15000, () => rq.destroy(new Error("GitHub API timeout")));
      rq.end();
    });
    const filtered = (Array.isArray(list) ? list : [])
      .filter((pr) => pr.head?.ref?.startsWith("si/"))
      .slice(0, 20)
      .map((pr) => ({
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        state: pr.state,
        merged: !!pr.merged_at,
        mergeable_state: pr.mergeable_state,
        head_branch: pr.head?.ref,
        created_at: pr.created_at,
        updated_at: pr.updated_at,
        merged_at: pr.merged_at,
        auto_merge: !!pr.auto_merge,
      }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ prs: filtered }));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "failed to list PRs",
        detail: String(e?.message || e),
      }),
    );
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

export async function handleProposalsList(req, res, { WORKDIR }) {
  try {
    const parsed = new URL(req.url, "http://localhost");
    const status = parsed.searchParams.get("status") || undefined;
    const proposals = listProposals(WORKDIR, { status });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ proposals }));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ error: "Failed to list proposals", detail: e.message }),
    );
  }
}

export async function handleProposalCreate(req, res, { WORKDIR, userEmail }) {
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
    const buf = await readBody(req, MAX_JSON_BODY_BYTES);
    const { files, baseCommit } = JSON.parse(buf.toString("utf8") || "{}");
    if (!Array.isArray(files) || files.length === 0) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "files array required" }));
      return;
    }
    const proposal = createProposal(WORKDIR, { files, baseCommit, userEmail });
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify(proposal));
  } catch (e) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid request", detail: e.message }));
  }
}

export async function handleProposalGet(_req, res, { WORKDIR, proposalId }) {
  try {
    const proposal = getProposal(WORKDIR, proposalId);
    if (!proposal) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Proposal not found" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(proposal));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ error: "Failed to get proposal", detail: e.message }),
    );
  }
}

export async function handleProposalConfirm(
  req,
  res,
  { WORKDIR, proposalId, userEmail, isRequestAdmin },
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
  try {
    const buf = await readBody(req, MAX_JSON_BODY_BYTES);
    const { hash } = JSON.parse(buf.toString("utf8") || "{}");
    if (!hash) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "hash is required" }));
      return;
    }
    const proposal = confirmProposal(WORKDIR, { proposalId, hash, userEmail });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(proposal));
  } catch (e) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ error: "Confirmation failed", detail: e.message }),
    );
  }
}

export async function handleProposalExecute(
  _req,
  res,
  { WORKDIR, proposalId, userEmail, isRequestAdmin, checkRateLimit },
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
  if (!tryAcquireBuildLock()) {
    res.writeHead(409, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error:
          "Another build/PR/rollback/execution is in progress. Wait and retry.",
      }),
    );
    return;
  }

  try {
    const uiDir = getUiDir(WORKDIR);
    const deps = {
      getCurrentCommit: async () => {
        try {
          const { stdout } = await execFileP("git", ["rev-parse", "HEAD"], {
            cwd: uiDir,
          });
          return (stdout || "").trim();
        } catch {
          return "unknown";
        }
      },
      applyFiles: async (files) => {
        for (const f of files) {
          // Same validation as the sandbox: rejects traversal ("src/../x"),
          // absolute paths, and anything outside src/**. resolveInside then
          // enforces the directory boundary on the resolved absolute path.
          const safePath = normalizeSandboxPath(f.path);
          const fullPath = resolveInside(uiDir, safePath);
          await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.promises.writeFile(fullPath, f.content || "", "utf8");
        }
      },
      createCheckpoint: async (workdir) => {
        return new Promise((resolve, reject) => {
          createCheckpoint(workdir, (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
        });
      },
      rebuildUi: async (workdir) => {
        return new Promise((resolve, reject) => {
          rebuildUi(workdir, (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
        });
      },
      healthcheck: async () => {
        // A build that "succeeded" can still ship a broken dist (e.g. the OOM
        // path leaves a stale index.html pointing at a bundle that was never
        // written). Verify index.html is non-empty, references a module
        // script, and every referenced /assets/* file actually exists.
        try {
          const distDir = "/app/dist";
          const html = await fs.promises.readFile(
            path.join(distDir, "index.html"),
            "utf8",
          );
          if (!html.trim() || !html.includes("<script")) return false;
          const refs = [
            ...html.matchAll(/(?:src|href)="\/(assets\/[^"?#]+)"/g),
          ].map((m) => m[1]);
          if (refs.length === 0) return false;
          for (const rel of refs) {
            const asset = path.join(distDir, rel);
            if (!fs.existsSync(asset) || fs.statSync(asset).size === 0)
              return false;
          }
          return true;
        } catch {
          return false;
        }
      },
      promoteDistSnapshot: async () => {
        return promoteDistSnapshot();
      },
      restoreLastPublishedDist: async () => {
        return restoreLatestDist();
      },
    };

    const result = await executeProposalTransaction(WORKDIR, proposalId, {
      userEmail,
      deps,
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Execution failed", detail: e.message }));
  } finally {
    releaseBuildLock();
  }
}

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
