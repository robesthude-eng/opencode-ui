// @vitest-environment node
/**
 * Tests for new registration invite code and admin email allowlist gates.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearCache, closeDb, initDb } from "../db.mjs";
import { handleRegister } from "../routes/auth.mjs";

let tmpDir;
let usersFile;
let sessionsFile;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-sec-test-"));
  closeDb();
  clearCache();
  initDb(tmpDir);
  usersFile = path.join(tmpDir, ".users.json");
  sessionsFile = path.join(tmpDir, ".sessions.json");
});

afterEach(() => {
  closeDb();
  clearCache();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.OPENCODE_INVITE_CODE;
  delete process.env.OPENCODE_ADMIN_EMAILS;
});

function createMockResponse() {
  return {
    writeHead: vi.fn(),
    end: vi.fn(),
  };
}

describe("handleRegister security gates", () => {
  test("allows registration without invite code if not configured", async () => {
    const req = {
      method: "POST",
      url: "/api/auth/register",
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
      on: (event, callback) => {
        if (event === "data") {
          callback(
            Buffer.from(
              JSON.stringify({
                email: "user@example.com",
                password: "password123",
              }),
            ),
          );
        } else if (event === "end") {
          callback();
        }
      },
    };
    const res = createMockResponse();

    await handleRegister(req, res, {
      USERS_FILE: usersFile,
      SESSIONS_FILE: sessionsFile,
      SESSION_TTL_MS: 3600,
    });

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
  });

  test("blocks registration if invite code is configured but missing/incorrect", async () => {
    process.env.OPENCODE_INVITE_CODE = "secret-invite-123";
    const req = {
      method: "POST",
      url: "/api/auth/register",
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
      on: (event, callback) => {
        if (event === "data") {
          callback(
            Buffer.from(
              JSON.stringify({
                email: "user@example.com",
                password: "password123",
                inviteCode: "wrong",
              }),
            ),
          );
        } else if (event === "end") {
          callback();
        }
      },
    };
    const res = createMockResponse();

    await handleRegister(req, res, {
      USERS_FILE: usersFile,
      SESSIONS_FILE: sessionsFile,
      SESSION_TTL_MS: 3600,
    });

    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    const body = JSON.parse(res.end.mock.calls[0][0]);
    expect(body.error).toContain("Invalid invite code");
  });

  test("allows registration with valid invite code", async () => {
    process.env.OPENCODE_INVITE_CODE = "secret-invite-123";
    const req = {
      method: "POST",
      url: "/api/auth/register",
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
      on: (event, callback) => {
        if (event === "data") {
          callback(
            Buffer.from(
              JSON.stringify({
                email: "user@example.com",
                password: "password123",
                inviteCode: "secret-invite-123",
              }),
            ),
          );
        } else if (event === "end") {
          callback();
        }
      },
    };
    const res = createMockResponse();

    await handleRegister(req, res, {
      USERS_FILE: usersFile,
      SESSIONS_FILE: sessionsFile,
      SESSION_TTL_MS: 3600,
    });

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
  });

  test("blocks registration if email is not on admin allowlist (if allowlist configured)", async () => {
    process.env.OPENCODE_ADMIN_EMAILS = "admin1@example.com,admin2@example.com";
    const req = {
      method: "POST",
      url: "/api/auth/register",
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
      on: (event, callback) => {
        if (event === "data") {
          callback(
            Buffer.from(
              JSON.stringify({
                email: "hacker@example.com",
                password: "password123",
              }),
            ),
          );
        } else if (event === "end") {
          callback();
        }
      },
    };
    const res = createMockResponse();

    await handleRegister(req, res, {
      USERS_FILE: usersFile,
      SESSIONS_FILE: sessionsFile,
      SESSION_TTL_MS: 3600,
    });

    expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
    const body = JSON.parse(res.end.mock.calls[0][0]);
    expect(body.error).toContain("admin allowlist");
  });
});
