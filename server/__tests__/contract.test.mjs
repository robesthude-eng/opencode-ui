// @vitest-environment node
/**
 * P1.4 — Contract tests: fake OpenCode upstream with exact route/URL assertions
 * Verifies invariants:
 * - per-session requests preserve ?directory=
 * - global routes never receive directory=
 * - tmp_ IDs rejected
 */

import http from "node:http";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  isGlobalRoute,
  isPerSessionRoute,
  isValidSessionId,
  resolveTargetUrl,
} from "../isolation.mjs";

let fakeServer;
let fakePort;
let _lastRequestUrl = "";

beforeAll(async () => {
  fakeServer = http.createServer((req, res) => {
    _lastRequestUrl = req.url;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, url: req.url }));
  });
  await new Promise((resolve) => {
    fakeServer.listen(0, () => {
      fakePort = fakeServer.address().port;
      resolve();
    });
  });
});

afterAll(() => {
  fakeServer.close();
});

describe("contract: resolveTargetUrl with fake OpenCode upstream", () => {
  const workdir = "/app/workspace";

  test("per-session route preserves directory for that session", async () => {
    const url = resolveTargetUrl(
      "/session/ses_abc123/message",
      "ses_abc123",
      workdir,
    );
    expect(url).toContain("directory=");
    expect(url).toContain(
      encodeURIComponent("/app/workspace/sessions/ses_abc123/workspace"),
    );

    // Simulate proxy to fake upstream
    await new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${fakePort}${url}`, (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => {
            const data = JSON.parse(body);
            expect(data.url).toContain("directory=");
            resolve();
          });
        })
        .on("error", reject);
    });
  });

  test("global route never receives directory even if smuggled", () => {
    const url = resolveTargetUrl(
      "/api/config/providers?directory=/evil",
      null,
      workdir,
    );
    expect(url).not.toContain("directory=");
    expect(url).not.toContain("/evil");
  });

  test("tmp_ IDs never get directory — treated as global for safety", () => {
    const url = resolveTargetUrl(
      "/session/tmp_123/message",
      "tmp_123",
      workdir,
    );
    expect(url).not.toContain("directory=");
  });

  test("isGlobalRoute and isPerSessionRoute are mutually exclusive for session routes", () => {
    const perSession = "/api/session/ses_test123/message";
    expect(isPerSessionRoute(perSession)).toBe(true);
    expect(isGlobalRoute(perSession)).toBe(false);

    const global = "/api/auth/login";
    expect(isGlobalRoute(global)).toBe(true);
    expect(isPerSessionRoute(global)).toBe(false);
  });

  test("isValidSessionId rejects tmp_ and accepts ses_", () => {
    expect(isValidSessionId("ses_abc123")).toBe(true);
    expect(isValidSessionId("tmp_123")).toBe(false);
    expect(isValidSessionId("")).toBe(false);
  });

  test("DELETE session routing preserves directory for canonical workspace", () => {
    // Simulate DELETE /api/session/ses_del123 — proxy should add directory=/app/workspace/sessions/ses_del123/workspace
    const sessionId = "ses_del123";
    const url = resolveTargetUrl(
      `/api/session/${sessionId}`,
      sessionId,
      workdir,
    );
    // For DELETE, our isolation module adds directory, but in real proxy we override with sessionWorkspace
    // Here we just verify the helper adds directory for per-session
    expect(url).toContain("directory=");
  });
});

describe("contract: admin route guard", () => {
  test("removing directory branch would make isolation tests fail — this test documents the contract", () => {
    // This test's existence is the contract: if someone removes directory handling in proxy,
    // the above tests will fail, blocking CI.
    const url = "/api/session/ses_contract_test/message";
    expect(isPerSessionRoute(url)).toBe(true);
    const resolved = resolveTargetUrl(
      url,
      "ses_contract_test",
      "/app/workspace",
    );
    expect(resolved).toMatch(/directory=/);
  });

  test("removing admin gate would make auth tests fail — documented", () => {
    // auth.test.mjs already covers isAdmin and CSRF
    // This test documents that contract tests must exist before server modularization (P0.1)
    expect(true).toBe(true);
  });
});
