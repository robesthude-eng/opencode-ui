// @vitest-environment node
/**
 * P0.1 Contract tests for isolation helpers
 * These tests enforce the non-negotiable invariants:
 * 1. Every per-session request preserves ?directory=
 * 2. Global routes never receive directory=
 * 3. tmp_ IDs are rejected
 */

import { describe, expect, test } from "vitest";
import {
  buildSafeWorkspacePath,
  extractSessionIdFromPath,
  getSessionWorkspace,
  isGlobalRoute,
  isPerSessionRoute,
  isValidSessionId,
  resolveTargetUrl,
} from "../isolation.mjs";

describe("isValidSessionId", () => {
  test("accepts real ses_ IDs", () => {
    expect(isValidSessionId("ses_abc123")).toBe(true);
    expect(isValidSessionId("ses_09c1d22d4ffey9FxxbsDPFMo54")).toBe(true);
    expect(isValidSessionId("ses_a-b_c")).toBe(true);
  });

  test("rejects tmp_ optimistic IDs", () => {
    expect(isValidSessionId("tmp_123")).toBe(false);
    expect(isValidSessionId("tmp_abc")).toBe(false);
  });

  test("rejects invalid formats", () => {
    expect(isValidSessionId("")).toBe(false);
    expect(isValidSessionId(null)).toBe(false);
    expect(isValidSessionId(undefined)).toBe(false);
    expect(isValidSessionId("ses with space")).toBe(false);
    expect(isValidSessionId("ses/../../etc")).toBe(false);
  });
});

describe("getSessionWorkspace", () => {
  test("builds isolated path", () => {
    const ws = getSessionWorkspace("ses_abc", "/app/workspace");
    expect(ws).toBe("/app/workspace/sessions/ses_abc/workspace");
  });

  test("throws on invalid session ID", () => {
    expect(() => getSessionWorkspace("tmp_123", "/app/workspace")).toThrow();
    expect(() => getSessionWorkspace("", "/app/workspace")).toThrow();
  });
});

describe("isGlobalRoute", () => {
  test("detects global routes", () => {
    expect(isGlobalRoute("/api/config/providers")).toBe(true);
    expect(isGlobalRoute("/api/provider")).toBe(true);
    expect(isGlobalRoute("/api/auth/login")).toBe(true);
    expect(isGlobalRoute("/api/auth/register")).toBe(true);
    expect(isGlobalRoute("/api/global/health")).toBe(true);
    expect(isGlobalRoute("/health")).toBe(true);
    expect(isGlobalRoute("/global/health")).toBe(true);
    expect(isGlobalRoute("/api/self-improve/prs")).toBe(true);
    expect(isGlobalRoute("/api/sandbox/apply")).toBe(true);
    expect(isGlobalRoute("/api/rebuild")).toBe(true);
  });

  test("per-session routes are not global", () => {
    expect(isGlobalRoute("/api/session/ses_abc/message")).toBe(false);
    expect(isGlobalRoute("/session/ses_abc/message")).toBe(false);
    expect(isGlobalRoute("/api/session/ses_abc")).toBe(false);
    expect(isGlobalRoute("/file?sessionId=ses_abc")).toBe(false);
  });
});

describe("isPerSessionRoute", () => {
  test("detects per-session routes", () => {
    expect(isPerSessionRoute("/session/ses_abc")).toBe(true);
    expect(isPerSessionRoute("/session/ses_abc/message")).toBe(true);
    expect(isPerSessionRoute("/api/session/ses_abc/message")).toBe(true);
    expect(isPerSessionRoute("/session/ses_abc/permissions/perm123")).toBe(
      true,
    );
    expect(isPerSessionRoute("/session/ses_abc/question/q123/reply")).toBe(
      true,
    );
  });

  test("global routes are not per-session", () => {
    expect(isPerSessionRoute("/api/auth/login")).toBe(false);
    expect(isPerSessionRoute("/api/config/providers")).toBe(false);
    expect(isPerSessionRoute("/health")).toBe(false);
  });
});

describe("extractSessionIdFromPath", () => {
  test("extracts valid ses_ ID", () => {
    expect(extractSessionIdFromPath("/session/ses_abc/message")).toBe(
      "ses_abc",
    );
    expect(
      extractSessionIdFromPath(
        "/api/session/ses_09c1d22d4ffey9FxxbsDPFMo54/event",
      ),
    ).toBe("ses_09c1d22d4ffey9FxxbsDPFMo54");
  });

  test("returns null for tmp_ IDs", () => {
    expect(extractSessionIdFromPath("/session/tmp_123/message")).toBeNull();
  });

  test("returns null when no session in path", () => {
    expect(extractSessionIdFromPath("/api/auth/login")).toBeNull();
    expect(extractSessionIdFromPath("/health")).toBeNull();
  });
});

describe("resolveTargetUrl — P0.1 invariants", () => {
  const workdir = "/app/workspace";

  test("per-session request preserves ?directory= for that session workspace", () => {
    const url = resolveTargetUrl(
      "/session/ses_abc/message",
      "ses_abc",
      workdir,
    );
    expect(url).toContain("directory=");
    expect(url).toContain(
      encodeURIComponent("/app/workspace/sessions/ses_abc/workspace"),
    );
  });

  test("per-session request with existing directory overwrites with canonical workspace", () => {
    const url = resolveTargetUrl(
      "/session/ses_abc/message?directory=/evil",
      "ses_abc",
      workdir,
    );
    expect(url).not.toContain("/evil");
    expect(url).toContain(
      encodeURIComponent("/app/workspace/sessions/ses_abc/workspace"),
    );
  });

  test("per-session request preserves other query params like limit, before", () => {
    const url = resolveTargetUrl(
      "/session/ses_abc/message?limit=10&before=msg_123",
      "ses_abc",
      workdir,
    );
    expect(url).toContain("limit=10");
    expect(url).toContain("before=msg_123");
    expect(url).toContain("directory=");
  });

  test("global routes never receive directory=", () => {
    const url = resolveTargetUrl("/api/config/providers", null, workdir);
    expect(url).not.toContain("directory=");

    const url2 = resolveTargetUrl(
      "/api/auth/login?directory=/evil",
      null,
      workdir,
    );
    expect(url2).not.toContain("directory=");

    const url3 = resolveTargetUrl(
      "/api/global/health?directory=/evil",
      null,
      workdir,
    );
    expect(url3).not.toContain("directory=");
  });

  test("global route with smuggled directory param strips it", () => {
    const url = resolveTargetUrl(
      "/api/provider?directory=/app/workspace/sessions/ses_abc/workspace",
      null,
      workdir,
    );
    expect(url).not.toContain("directory=");
  });

  test("tmp_ IDs never get directory — returned URL without directory", () => {
    const url = resolveTargetUrl(
      "/session/tmp_123/message",
      "tmp_123",
      workdir,
    );
    expect(url).not.toContain("directory=");
    // Caller should treat tmp_ as 410 Gone, but resolver itself strips directory for safety
  });

  test("removing a directory= branch makes CI fail — simulated by this test existing", () => {
    // This test's existence is the contract: if someone removes directory handling,
    // isPerSessionRoute + resolveTargetUrl tests will fail.
    const perSessionUrl = "/api/session/ses_test/message";
    expect(isPerSessionRoute(perSessionUrl)).toBe(true);
    const resolved = resolveTargetUrl(perSessionUrl, "ses_test", workdir);
    expect(resolved).toMatch(/directory=/);
  });
});

describe("buildSafeWorkspacePath", () => {
  test("prevents path traversal", () => {
    // Valid path
    expect(buildSafeWorkspacePath("ses_abc", "/app/workspace")).toBe(
      "/app/workspace/sessions/ses_abc/workspace",
    );

    // Even if session ID looks valid, resolved path must stay inside workdir
    // (getSessionWorkspace already uses path.join, so traversal via sessionId is impossible if isValidSessionId rejects slashes)
    expect(() =>
      buildSafeWorkspacePath("ses_../../etc", "/app/workspace"),
    ).toThrow();
  });
});
