// @vitest-environment node
/**
 * Tests for handleSelfImproveRoute in server/routes/self-improve.mjs
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearCache, closeDb } from "../db.mjs";
import { handleSelfImproveRoute } from "../routes/self-improve.mjs";

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "si-routes-test-"));
  closeDb();
  clearCache();
});

afterEach(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  clearCache();
});

function createMockResponse() {
  const res = {
    writeHead: vi.fn(),
    end: vi.fn(),
  };
  return res;
}

describe("central admin gate", () => {
  const nonAdminCtx = () => ({
    WORKDIR: tmpDir,
    userEmail: "user@b.com",
    isRequestAdmin: false,
  });

  test("GET /api/settings/self-improve is readable by non-admins (canWrite=false)", async () => {
    const req = { url: "/api/settings/self-improve", method: "GET" };
    const res = createMockResponse();
    await handleSelfImproveRoute(req, res, nonAdminCtx());
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "application/json",
    });
    const body = JSON.parse(res.end.mock.calls[0][0]);
    expect(body.canWrite).toBe(false);
  });

  test.each([
    ["POST", "/api/settings/self-improve"],
    ["POST", "/api/self-improve/resync"],
    ["POST", "/api/self-improve/create-pr"],
    ["GET", "/api/self-improve/prs"],
    ["POST", "/api/rebuild"],
    ["POST", "/api/reset-ui"],
    ["POST", "/api/git/checkpoint"],
    ["GET", "/api/git/checkpoints"],
    ["POST", "/api/git/rollback"],
    ["POST", "/api/dist/rollback"],
    ["GET", "/api/dist/snapshots"],
    ["GET", "/api/self-improve/proposals"],
    ["POST", "/api/self-improve/proposals"],
    ["GET", "/api/self-improve/proposals/prp_x"],
    ["POST", "/api/self-improve/proposals/prp_x/confirm"],
    ["POST", "/api/self-improve/proposals/prp_x/execute"],
  ])("%s %s returns 403 for non-admins", async (method, url) => {
    const req = { url, method };
    const res = createMockResponse();
    await handleSelfImproveRoute(req, res, nonAdminCtx());
    expect(res.writeHead).toHaveBeenCalledWith(403, {
      "Content-Type": "application/json",
    });
    const body = JSON.parse(res.end.mock.calls[0][0]);
    expect(body.error).toMatch(/Admin/);
  });
});

describe("handleSelfImproveRoute routing and dispatch", () => {
  test("returns 404 for unknown route", async () => {
    const req = { url: "/api/self-improve/unknown", method: "GET" };
    const res = createMockResponse();
    await handleSelfImproveRoute(req, res, {
      WORKDIR: tmpDir,
      userEmail: "a@b.com",
      isRequestAdmin: true,
    });
    expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
  });

  test("GET /api/settings/self-improve returns settings status", async () => {
    const req = { url: "/api/settings/self-improve", method: "GET" };
    const res = createMockResponse();
    await handleSelfImproveRoute(req, res, {
      WORKDIR: tmpDir,
      userEmail: "a@b.com",
      isRequestAdmin: true,
    });
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "application/json",
    });
    const responseData = JSON.parse(res.end.mock.calls[0][0]);
    expect(responseData).toHaveProperty("enabled", false);
    expect(responseData).toHaveProperty("sessionId", null);
  });

  test("GET /api/self-improve/proposals starts with empty list", async () => {
    const req = { url: "/api/self-improve/proposals", method: "GET" };
    const res = createMockResponse();
    await handleSelfImproveRoute(req, res, {
      WORKDIR: tmpDir,
      userEmail: "a@b.com",
      isRequestAdmin: true,
    });
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "application/json",
    });
    const responseData = JSON.parse(res.end.mock.calls[0][0]);
    expect(responseData).toHaveProperty("proposals", []);
  });
});
