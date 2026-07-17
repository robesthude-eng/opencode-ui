// @vitest-environment node
/**
 * Tests for handleBackupRoute in server/routes/backup.mjs
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearCache, closeDb, initDb, saveJson } from "../db.mjs";
import { handleBackupRoute } from "../routes/backup.mjs";

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-routes-test-"));
  closeDb();
  clearCache();
  initDb(tmpDir);
  // seed a user
  saveJson(path.join(tmpDir, ".users.json"), {
    "a@example.com": {
      email: "a@example.com",
      passwordHash: "s:h",
      role: "admin",
      createdAt: 1,
    },
  });
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

describe("handleBackupRoute routing and dispatch", () => {
  test("returns 404 for unknown route", async () => {
    const req = { url: "/api/db/unknown", method: "GET" };
    const res = createMockResponse();
    await handleBackupRoute(req, res, {
      WORKDIR: tmpDir,
      userEmail: "a@example.com",
      isRequestAdmin: true,
    });
    expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
  });

  test("GET /api/db/backups returns empty array if no backups", async () => {
    const req = { url: "/api/db/backups", method: "GET" };
    const res = createMockResponse();
    await handleBackupRoute(req, res, {
      WORKDIR: tmpDir,
      userEmail: "a@example.com",
      isRequestAdmin: true,
    });
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "application/json",
    });
    const responseData = JSON.parse(res.end.mock.calls[0][0]);
    expect(responseData).toEqual([]);
  });

  test("GET /api/db/backups blocks non-admins", async () => {
    const req = { url: "/api/db/backups", method: "GET" };
    const res = createMockResponse();
    await handleBackupRoute(req, res, {
      WORKDIR: tmpDir,
      userEmail: "u@example.com",
      isRequestAdmin: false,
    });
    expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
  });

  test("POST /api/db/backup/restore blocks non-admins", async () => {
    const req = { url: "/api/db/backup/restore", method: "POST" };
    const res = createMockResponse();
    await handleBackupRoute(req, res, {
      WORKDIR: tmpDir,
      userEmail: "u@example.com",
      isRequestAdmin: false,
    });
    expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
  });
});
