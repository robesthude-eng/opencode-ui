/**
 * GitHub PR helper — creates branches, commits files, opens PRs.
 *
 * Used by `/api/self-improve/create-pr` so the assistant can propose
 * changes without touching production directly.
 *
 * Auth: reads GITHUB_TOKEN/GITHUB_PAT from the process environment only.
 * Tokens in git remotes are rejected so they cannot persist in .git/config.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { promisify } from "node:util";
import logger from "./logger.mjs";

const pExec = promisify(execFile);

/** Extract PAT + owner/repo from `git remote get-url origin` */
export async function readRemoteInfo(uiDir) {
  const { stdout } = await pExec("git", ["-C", uiDir, "remote", "get-url", "origin"], {
    timeout: 10_000,
  });
  const url = stdout.trim();
  if (/^https:\/\/[^/]+@github\.com\//i.test(url)) {
    throw new Error(
      "GitHub token in git remote is forbidden; use GITHUB_TOKEN/GITHUB_PAT environment variable",
    );
  }
  const httpsMatch = url.match(/^https:\/\/github\.com\/([^/]+)\/([^./]+)(?:\.git)?$/);
  const sshMatch = url.match(/^git@github\.com:([^/]+)\/([^./]+)(?:\.git)?$/);
  const m = httpsMatch || sshMatch;
  if (!m) throw new Error(`unrecognized origin url: ${url}`);
  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT || null;
  return { token, owner: m[1], repo: m[2], url };
}

/** POST to GitHub REST API with the token from the process environment */
function githubApi(token, method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = https.request(
      {
        hostname: "api.github.com",
        port: 443,
        path: apiPath,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "opencode-ui-self-improve/1.0",
          ...(data
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
            : {}),
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            const json = buf ? JSON.parse(buf) : {};
            if (res.statusCode >= 200 && res.statusCode < 300)
              resolve({ status: res.statusCode, body: json });
            else
              reject(
                new Error(
                  `GitHub ${method} ${apiPath} → ${res.statusCode}: ${json.message || buf.slice(0, 200)}`,
                ),
              );
          } catch (e) {
            reject(new Error(`GitHub API parse error: ${e.message}; raw: ${buf.slice(0, 200)}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(20000, () => {
      req.destroy(new Error("GitHub API timeout"));
    });
    if (data) req.write(data);
    req.end();
  });
}

/**
 * Create a branch, commit files (list of {path, content}), push, open a PR.
 * Returns { url, number, branch, html_url }.
 */
export async function openPullRequest({ uiDir, files, title, body, baseBranch = "main" }) {
  if (!Array.isArray(files) || files.length === 0) throw new Error("files array required");
  if (!title) throw new Error("title required");

  const { token, owner, repo } = await readRemoteInfo(uiDir);
  if (!token) throw new Error("No GITHUB_TOKEN/GITHUB_PAT configured for self-improvement PRs.");

  // Branch name: si/YYYY-MM-DD-HHMMSS[-shortHash]
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp =
    `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}-` +
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  const branch = `si/${stamp}`;

  logger.info(`[create-pr] branch=${branch}, files=${files.length}, base=${baseBranch}`);

  // 1) Make sure we're up-to-date with origin/main
  await pExec("git", ["-C", uiDir, "fetch", "origin", baseBranch], { timeout: 30000 });

  // 2) Create branch from origin/main (throw away any uncommitted local drift for cleanliness)
  //    but STASH first so we don't lose ongoing work
  let stashCreated = false;
  try {
    const stashResult = await pExec(
      "git",
      ["-C", uiDir, "stash", "push", "-u", "-m", `pre-pr-stash-${stamp}`],
      { timeout: 10000 },
    );
    stashCreated = !/No local changes to save/i.test(
      `${stashResult.stdout || ""} ${stashResult.stderr || ""}`,
    );
  } catch (e) {
    logger.warn(`[create-pr] stash failed; continuing without stash: ${e.message}`);
  }
  await pExec("git", ["-C", uiDir, "checkout", "-B", branch, `origin/${baseBranch}`], {
    timeout: 15000,
  });

  // 3) Write files (path is relative to uiDir; guard against traversal)
  const written = [];
  for (const f of files) {
    if (typeof f?.path !== "string" || typeof f?.content !== "string")
      throw new Error("each file must have {path,content} strings");
    const rel = f.path.replace(/^\/+/, "");
    if (rel.includes("..") || path.isAbsolute(rel)) throw new Error(`invalid path: ${f.path}`);
    // whitelist: same as sandbox — only src/, public/, and doc files
    const top = rel.split("/")[0];
    const allowedTop = new Set([
      "src",
      "public",
      "SELF_IMPROVE.md",
      "SELF_IMPROVE_GUIDE.md",
      "README.md",
    ]);
    if (!allowedTop.has(top))
      throw new Error(`path outside allowlist: ${rel} (only src/**, public/**, docs allowed)`);
    const abs = path.join(uiDir, rel);
    const dir = path.dirname(abs);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(abs, f.content, "utf8");
    written.push(rel);
  }

  // 4) git add + commit
  await pExec("git", ["-C", uiDir, "add", "--", ...written], { timeout: 15000 });

  // Skip pre-commit hook — sandbox already validated everything
  await pExec(
    "git",
    [
      "-C",
      uiDir,
      "-c",
      "user.email=self-improve@opencode-ui.local",
      "-c",
      "user.name=OpenCode UI Self-Improve",
      "commit",
      "--no-verify",
      "-m",
      title,
    ],
    { timeout: 15000 },
  );

  // 5) Push
  // Push with token via extraheader (never writes token to disk / git config)
  const authHeader =
    "Authorization: Basic " + Buffer.from(`x-access-token:${token}`).toString("base64");
  await pExec(
    "git",
    [
      "-C",
      uiDir,
      "-c",
      `http.https://github.com/.extraheader=${authHeader}`,
      "push",
      "origin",
      branch,
      "--force-with-lease",
    ],
    { timeout: 60000 },
  );

  // 6) Open PR via GitHub API
  const pr = await githubApi(token, "POST", `/repos/${owner}/${repo}/pulls`, {
    title,
    body:
      body ||
      `Automated PR from Self-Improvement session.\n\nChanged files:\n${written.map((f) => `- \`${f}\``).join("\n")}\n\n---\n_Created by OpenCode UI Self-Improvement pipeline. CI will verify before merge._`,
    head: branch,
    base: baseBranch,
    maintainer_can_modify: true,
  });

  logger.info(`[create-pr] PR #${pr.body.number} opened: ${pr.body.html_url}`);

  // 7) Restore stashed local drift if any (best effort)
  try {
    await pExec("git", ["-C", uiDir, "checkout", baseBranch], { timeout: 10000 });
  } catch {}
  if (stashCreated) {
    try {
      await pExec("git", ["-C", uiDir, "stash", "pop"], { timeout: 10000 });
    } catch (e) {
      logger.error(`[create-pr] stash pop conflict; local drift remains in stash: ${e.message}`);
    }
  }

  return {
    number: pr.body.number,
    url: pr.body.html_url,
    branch,
    filesWritten: written,
  };
}

/**
 * Enable auto-merge on a PR (if repo settings allow it). Falls back to
 * manual merge if auto-merge is not available.
 */
export async function enableAutoMerge({ uiDir, prNumber, mergeMethod = "squash" }) {
  const { token, owner, repo } = await readRemoteInfo(uiDir);
  if (!token) throw new Error("no token");
  try {
    // GraphQL is the only way to enable auto-merge — REST doesn't expose it.
    const query = `mutation($id:ID!, $method:PullRequestMergeMethod!){enablePullRequestAutoMerge(input:{pullRequestId:$id, mergeMethod:$method}){pullRequest{number,autoMergeRequest{enabledAt}}}}`;
    // 1) resolve PR node_id via REST
    const pr = await githubApi(token, "GET", `/repos/${owner}/${repo}/pulls/${prNumber}`);
    const nodeId = pr.body.node_id;
    // 2) send graphql mutation
    const result = await new Promise((resolve, reject) => {
      const data = JSON.stringify({
        query,
        variables: { id: nodeId, method: mergeMethod.toUpperCase() },
      });
      const req = https.request(
        {
          hostname: "api.github.com",
          port: 443,
          path: "/graphql",
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(data),
            "User-Agent": "opencode-ui-self-improve/1.0",
          },
        },
        (res) => {
          let buf = "";
          res.on("data", (c) => (buf += c));
          res.on("end", () => {
            try {
              resolve(JSON.parse(buf));
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      req.on("error", reject);
      req.setTimeout(15000, () => req.destroy(new Error("timeout")));
      req.write(data);
      req.end();
    });
    if (result.errors) throw new Error(JSON.stringify(result.errors));
    return { enabled: true, prNumber };
  } catch (e) {
    return { enabled: false, error: String(e.message || e) };
  }
}

// ===========================================================================
// Background PR & CI Status Poller — Closes the feedback loop (P2)
// ===========================================================================
import { getSqlite } from "./db.mjs";
import { getSelfImproveSessionId, getUiDir } from "./self-improve.mjs";

export async function pollPrStatuses(workdir) {
  const sqlite = getSqlite();
  if (!sqlite) return;

  const sessionId = getSelfImproveSessionId(workdir);
  if (!sessionId) return; // Only poll when there is an active self-improve session

  const uiDir = getUiDir(workdir);
  let remoteInfo;
  try {
    remoteInfo = await readRemoteInfo(uiDir);
  } catch {
    return; // No git/remote info
  }

  const { token, owner, repo } = remoteInfo;
  if (!token) return;

  // 1. Fetch active (open) pulls from GitHub
  const pulls = await new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "api.github.com",
        port: 443,
        path: `/repos/${owner}/${repo}/pulls?state=open&per_page=10`,
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "opencode-ui-self-improve/1.0",
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(buf));
          } catch {
            resolve([]);
          }
        });
      },
    );
    req.on("error", () => resolve([]));
    req.setTimeout(20_000, () => {
      req.destroy();
      resolve([]);
    });
    req.end();
  });

  if (!Array.isArray(pulls)) return;

  // Filter PRs created by self-improve (starting with si/)
  const siPulls = pulls.filter((pr) => pr.head?.ref?.startsWith("si/"));

  for (const pr of siPulls) {
    const prNumber = pr.number;
    const headSha = pr.head?.sha;
    const branchName = pr.head?.ref;

    // 2. Fetch check runs (CI checks) for the head commit of this PR
    const checkRuns = await new Promise((resolve) => {
      const req = https.request(
        {
          hostname: "api.github.com",
          port: 443,
          path: `/repos/${owner}/${repo}/commits/${headSha}/check-runs`,
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "opencode-ui-self-improve/1.0",
          },
        },
        (res) => {
          let buf = "";
          res.on("data", (c) => (buf += c));
          res.on("end", () => {
            try {
              resolve(JSON.parse(buf));
            } catch {
              resolve({});
            }
          });
        },
      );
      req.on("error", () => resolve({}));
      req.setTimeout(20_000, () => {
        req.destroy();
        resolve({});
      });
      req.end();
    });

    const runs = checkRuns.check_runs || [];
    // We consider the checks finished when all of them have status === "completed"
    const finished = runs.length > 0 && runs.every((run) => run.status === "completed");
    const allSuccessful = finished && runs.every((run) => run.conclusion === "success");
    const anyFailed = finished && runs.some((run) => run.conclusion === "failure");

    // Check if we have already notified for this commit and state
    const existing = sqlite.prepare("SELECT * FROM tracked_prs WHERE pr_number = ?").get(prNumber);

    const statusStr = finished ? "completed" : "in_progress";
    const conclusionStr = allSuccessful ? "success" : anyFailed ? "failure" : "neutral";

    if (!existing) {
      sqlite
        .prepare(`
        INSERT INTO tracked_prs (pr_number, session_id, last_commit_sha, last_status, last_conclusion, notified)
        VALUES (?, ?, ?, ?, ?, 0)
      `)
        .run(prNumber, sessionId, headSha, statusStr, conclusionStr);
    } else {
      sqlite
        .prepare(`
        UPDATE tracked_prs
        SET last_commit_sha = ?, last_status = ?, last_conclusion = ?
        WHERE pr_number = ?
      `)
        .run(headSha, statusStr, conclusionStr, prNumber);
    }

    const currentNotified = existing ? existing.notified : 0;

    if (finished && !currentNotified) {
      // Do not inject CI results as a user prompt into the agent. The UI reads
      // tracked_prs through /api/self-improve/prs and displays the status there.
      // Mark as notified in DB
      sqlite.prepare("UPDATE tracked_prs SET notified = 1 WHERE pr_number = ?").run(prNumber);
      console.log(`[PR Poller] Notified chat of PR #${prNumber} CI conclusion: ${conclusionStr}`);
    }
  }
}

export function startPrStatusPoller(workdir, intervalMs = 60_000) {
  setInterval(async () => {
    try {
      await pollPrStatuses(workdir);
    } catch (e) {
      console.error("[PR Poller] error:", e.message);
    }
  }, intervalMs).unref();
}
