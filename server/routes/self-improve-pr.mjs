/**
 * Релиз 5 (Пакет 3): PR-хендлеры вынесены из routes/self-improve.mjs без изменений.
 * Гейты (isSelfImproveEnabled, rate limit, build lock) сохранены в исходном порядке.
 */
import https from "node:https";
import { MAX_JSON_BODY_BYTES, readBody } from "../middleware.mjs";
import {
  getUiDir,
  isSelfImproveEnabled,
  releaseBuildLock,
  tryAcquireBuildLock,
} from "../self-improve.mjs";

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
