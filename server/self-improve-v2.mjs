/**
 * P1.3 — Self-improve v2 transaction
 * Implements proposal → diff → confirmed → applying → checkpointed → building → healthcheck → published | rolled_back | failed
 *
 * Proposal TTL: 15 minutes, single-use
 * Audit records user, action, proposal hash and file list — not secret-bearing contents
 * Failed healthcheck must restore previous published dist
 *
 * Storage: SQLite proposals table + filesystem for file contents
 */

import crypto from "node:crypto";
import { getSqlite, initDb } from "./db.mjs";
import { validateSandboxFiles } from "./sandbox.mjs";
import { logAudit } from "./self-improve.mjs";

const PROPOSAL_TTL_MS = 15 * 60 * 1000; // 15 minutes

function getDb(workdir) {
  initDb(workdir);
  const sqlite = getSqlite();
  if (!sqlite) throw new Error("SQLite not initialized");
  // Ensure proposals table exists
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY,
      base_commit TEXT NOT NULL,
      hash TEXT NOT NULL,
      files TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      confirmed_at INTEGER,
      applied_at INTEGER,
      user_email TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
    CREATE INDEX IF NOT EXISTS idx_proposals_expires ON proposals(expires_at);
  `);
  return sqlite;
}

function hashFiles(files) {
  // Normalized diff + SHA-256 hash — files sorted by path, content normalized (trim + LF)
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const normalized = sorted
    .map((f) => {
      const content = (f.content || "").replace(/\r\n/g, "\n").trim();
      return `${f.path}\n${content}`;
    })
    .join("\n---\n");
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

function normalizeDiff(files, baseCommit) {
  // Returns normalized diff representation
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  return {
    baseCommit,
    files: sorted.map((f) => ({ path: f.path, size: (f.content || "").length })),
    hash: hashFiles(files),
  };
}

export function createProposal(workdir, { files, baseCommit, userEmail }) {
  // Fail fast: enforce the same rules as the sandbox (src/** only, no
  // traversal, ≤20 files, ≤200 KB total, no duplicates) at proposal time
  // instead of discovering an invalid path minutes later during execute.
  files = validateSandboxFiles(files);
  const db = getDb(workdir);
  const id = `prp_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
  const now = Date.now();
  const hash = hashFiles(files);
  const expiresAt = now + PROPOSAL_TTL_MS;

  const tx = db.transaction(() => {
    // Cleanup expired proposals
    db.prepare("DELETE FROM proposals WHERE expires_at < ?").run(now);
    // Insert new proposal
    db.prepare(`
      INSERT INTO proposals (id, base_commit, hash, files, status, created_at, expires_at, user_email)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      baseCommit || "unknown",
      hash,
      JSON.stringify(files),
      "proposal",
      now,
      expiresAt,
      userEmail || "unknown",
    );
  });
  tx();

  logAudit(
    workdir,
    userEmail || "system",
    "SI_V2_PROPOSAL",
    `id=${id} hash=${hash.slice(0, 12)} files=${files.length} base=${baseCommit}`,
  );

  return {
    id,
    hash,
    baseCommit,
    files: files.map((f) => f.path),
    status: "proposal",
    createdAt: now,
    expiresAt,
    ttl: PROPOSAL_TTL_MS,
  };
}

export function getProposal(workdir, proposalId) {
  const db = getDb(workdir);
  const row = db.prepare("SELECT * FROM proposals WHERE id = ?").get(proposalId);
  if (!row) return null;
  const now = Date.now();
  if (row.expires_at < now && row.status === "proposal") {
    // Expired
    db.prepare("UPDATE proposals SET status = ? WHERE id = ?").run("expired", proposalId);
    return { ...row, status: "expired", files: JSON.parse(row.files) };
  }
  return {
    ...row,
    files: JSON.parse(row.files),
  };
}

export function listProposals(workdir, { status } = {}) {
  const db = getDb(workdir);
  const now = Date.now();
  // Cleanup expired
  db.prepare("DELETE FROM proposals WHERE expires_at < ? AND status = 'proposal'").run(now);

  let query = "SELECT * FROM proposals ORDER BY created_at DESC LIMIT 50";
  let rows;
  if (status) {
    query = "SELECT * FROM proposals WHERE status = ? ORDER BY created_at DESC LIMIT 50";
    rows = db.prepare(query).all(status);
  } else {
    rows = db.prepare(query).all();
  }
  return rows.map((r) => ({
    id: r.id,
    hash: r.hash,
    baseCommit: r.base_commit,
    status: r.status,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    confirmedAt: r.confirmed_at,
    appliedAt: r.applied_at,
    userEmail: r.user_email,
    files: JSON.parse(r.files).map((f) => f.path || f),
  }));
}

export function confirmProposal(workdir, { proposalId, hash, userEmail }) {
  const db = getDb(workdir);
  const proposal = getProposal(workdir, proposalId);
  if (!proposal) throw new Error("Proposal not found");
  if (proposal.status !== "proposal")
    throw new Error(`Proposal already ${proposal.status}, not confirmable`);
  if (proposal.hash !== hash) throw new Error("Hash mismatch — proposal files changed");

  const now = Date.now();
  if (proposal.expires_at < now) throw new Error("Proposal expired (15min TTL)");

  // Verify baseCommit still matches current HEAD (optimistic concurrency)
  // This will be checked in transaction step, but we store confirmation now
  db.prepare("UPDATE proposals SET status = ?, confirmed_at = ?, user_email = ? WHERE id = ?").run(
    "confirmed",
    now,
    userEmail || proposal.user_email,
    proposalId,
  );

  logAudit(workdir, userEmail, "SI_V2_CONFIRMED", `id=${proposalId} hash=${hash.slice(0, 12)}`);

  return { ...proposal, status: "confirmed", confirmedAt: now };
}

export function markProposalStatus(workdir, proposalId, status, { userEmail } = {}) {
  const db = getDb(workdir);
  const now = Date.now();
  const field =
    status === "applying" ? "applied_at" : status === "confirmed" ? "confirmed_at" : null;
  if (field) {
    db.prepare(`UPDATE proposals SET status = ?, ${field} = ? WHERE id = ?`).run(
      status,
      now,
      proposalId,
    );
  } else {
    db.prepare("UPDATE proposals SET status = ? WHERE id = ?").run(status, proposalId);
  }
  if (userEmail) {
    logAudit(workdir, userEmail, `SI_V2_${status.toUpperCase()}`, `id=${proposalId}`);
  }
  return getProposal(workdir, proposalId);
}

export function getProposalDiff(workdir, proposalId) {
  const proposal = getProposal(workdir, proposalId);
  if (!proposal) throw new Error("Proposal not found");
  const files = typeof proposal.files === "string" ? JSON.parse(proposal.files) : proposal.files;
  // If files is array of objects with content, normalize
  const fileObjs =
    Array.isArray(files) && files.length > 0 && typeof files[0] === "object" && files[0].path
      ? files
      : [];
  // For diff, we need to handle both cases: files stored as objects or as paths
  // If stored as objects, use them; if as paths, we can't diff without content (should not happen)
  const normalized = normalizeDiff(fileObjs.length > 0 ? fileObjs : [], proposal.base_commit);
  return normalized;
}

/**
 * Full transaction: proposal → applying → checkpointed → building → healthcheck → published | rolled_back
 * This is the core P1.3 flow, called after confirm.
 * Steps:
 * 1. Verify baseCommit matches current HEAD (git rev-parse HEAD)
 * 2. Apply files to workspace
 * 3. Checkpoint (git commit)
 * 4. Build (vite build)
 * 5. Healthcheck (curl /health and check dist exists)
 * 6. Atomic publish (promoteDistSnapshot) or restore last published dist
 */
export async function executeProposalTransaction(workdir, proposalId, { userEmail, deps }) {
  const {
    getCurrentCommit,
    applyFiles,
    createCheckpoint,
    rebuildUi,
    healthcheck,
    promoteDistSnapshot,
    // Restores the last PUBLISHED snapshot. On a failed build/healthcheck the
    // broken output sits in /app/dist unpromoted, so the newest snapshot is
    // still the last good version — that is what must be restored (previously
    // this called instantRollbackDist(1), which skipped two versions back).
    restoreLastPublishedDist,
  } = deps;

  const proposal = getProposal(workdir, proposalId);
  if (!proposal) throw new Error("Proposal not found for execution");
  if (proposal.status !== "confirmed")
    throw new Error(`Proposal status ${proposal.status} not confirmed`);
  if (proposal.expires_at && proposal.expires_at < Date.now()) {
    markProposalStatus(workdir, proposalId, "expired", { userEmail });
    throw new Error("Proposal expired (15min TTL)");
  }

  // createProposal stores the full validated [{path, content}] array as JSON.
  const db = getDb(workdir);
  const rawRow = db.prepare("SELECT files FROM proposals WHERE id = ?").get(proposalId);
  let fullFiles;
  try {
    fullFiles = JSON.parse(rawRow.files);
  } catch {
    fullFiles = [];
  }
  if (!Array.isArray(fullFiles) || fullFiles.length === 0 || !fullFiles[0]?.path) {
    throw new Error("Proposal has no applicable file contents");
  }

  try {
    // Step 1: Verify baseCommit
    markProposalStatus(workdir, proposalId, "applying", { userEmail });
    const currentCommit = await getCurrentCommit();
    if (
      proposal.base_commit &&
      proposal.base_commit !== "unknown" &&
      currentCommit !== proposal.base_commit
    ) {
      logAudit(
        workdir,
        userEmail,
        "SI_V2_BASE_DIVERGED",
        `id=${proposalId} expected=${proposal.base_commit} current=${currentCommit}`,
      );
      throw new Error(
        `Base commit mismatch: expected ${proposal.base_commit}, got ${currentCommit}. Recreate the proposal.`,
      );
    }

    // Step 2: Apply files
    await applyFiles(fullFiles);

    // Step 3: Checkpoint
    markProposalStatus(workdir, proposalId, "checkpointed", { userEmail });
    const checkpoint = await createCheckpoint(workdir);
    logAudit(
      workdir,
      userEmail,
      "SI_V2_CHECKPOINTED",
      `id=${proposalId} commit=${checkpoint.commit}`,
    );

    // Step 4: Building
    markProposalStatus(workdir, proposalId, "building", { userEmail });
    const buildResult = await rebuildUi(workdir);
    logAudit(workdir, userEmail, "SI_V2_BUILDING", `id=${proposalId}`);

    // Step 5: Healthcheck
    markProposalStatus(workdir, proposalId, "healthcheck", { userEmail });
    const healthy = await healthcheck();
    if (!healthy) {
      // Failed healthcheck → rollback to previous dist
      logAudit(workdir, userEmail, "SI_V2_HEALTHCHECK_FAILED", `id=${proposalId}`);
      const rollback = await restoreLastPublishedDist();
      markProposalStatus(workdir, proposalId, "rolled_back", { userEmail });
      return {
        status: "rolled_back",
        checkpoint,
        buildResult,
        rollback,
        reason: "healthcheck failed",
      };
    }

    // Step 6: Atomic publish
    const snapshot = await promoteDistSnapshot();
    markProposalStatus(workdir, proposalId, "published", { userEmail });
    logAudit(workdir, userEmail, "SI_V2_PUBLISHED", `id=${proposalId} snapshot=${snapshot}`);

    return { status: "published", checkpoint, buildResult, snapshot };
  } catch (e) {
    // On any error, try to rollback dist
    try {
      const rollback = await restoreLastPublishedDist();
      markProposalStatus(workdir, proposalId, "rolled_back", { userEmail });
      return { status: "rolled_back", error: e.message, rollback };
    } catch (rbErr) {
      markProposalStatus(workdir, proposalId, "failed", { userEmail });
      throw new Error(
        `Transaction failed and rollback failed: ${e.message}, rollback: ${rbErr.message}`,
      );
    }
  }
}
