/**
 * Релиз 5 (Пакет 3): proposals-хендлеры (v2-транзакции) вынесены из
 * routes/self-improve.mjs без изменений логики и порядка гейтов.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { MAX_JSON_BODY_BYTES, readBody } from "../middleware.mjs";
import { normalizeSandboxPath, resolveInside } from "../sandbox.mjs";
import {
  createCheckpoint,
  getUiDir,
  isSelfImproveEnabled,
  promoteDistSnapshot,
  rebuildUi,
  releaseBuildLock,
  restoreLatestDist,
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
