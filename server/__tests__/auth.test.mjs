// @vitest-environment node
/**
 * Tests for server/auth.mjs
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  buildClearSessionCookie,
  buildSessionCookie,
  checkAuth,
  checkAuthRateLimit,
  checkCsrf,
  extractToken,
  getClientIp,
  getUserEmail,
  hashPassword,
  isAdmin,
  isSessionExpired,
  isTrustedProxy,
  parseCookies,
  resetAuthRateLimit,
  SESSION_COOKIE,
  verifyPassword,
} from "../auth.mjs";
import { clearCache, saveJson } from "../db.mjs";

// Create temp directory for tests
let tmpDir;
let usersFile;
let sessionsFile;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-test-"));
  usersFile = path.join(tmpDir, ".users.json");
  sessionsFile = path.join(tmpDir, ".sessions.json");
  clearCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("trusted reverse proxy headers", () => {
  const originalTrustedProxyIps = process.env.TRUSTED_PROXY_IPS;

  afterEach(() => {
    if (originalTrustedProxyIps === undefined)
      delete process.env.TRUSTED_PROXY_IPS;
    else process.env.TRUSTED_PROXY_IPS = originalTrustedProxyIps;
  });

  test("ignores X-Forwarded-For from an untrusted direct peer", () => {
    delete process.env.TRUSTED_PROXY_IPS;
    const req = {
      headers: { "x-forwarded-for": "198.51.100.7" },
      socket: { remoteAddress: "203.0.113.9" },
    };
    expect(isTrustedProxy(req)).toBe(false);
    expect(getClientIp(req)).toBe("203.0.113.9");
  });

  test("uses X-Forwarded-For only when the socket peer is allowlisted", () => {
    process.env.TRUSTED_PROXY_IPS = "172.18.0.2,::1";
    const req = {
      headers: { "x-forwarded-for": "198.51.100.7, 172.18.0.2" },
      socket: { remoteAddress: "172.18.0.2" },
    };
    expect(isTrustedProxy(req)).toBe(true);
    expect(getClientIp(req)).toBe("198.51.100.7");
  });

  test("normalizes IPv4-mapped proxy peers and rejects malformed XFF", () => {
    process.env.TRUSTED_PROXY_IPS = "127.0.0.1";
    const req = {
      headers: { "x-forwarded-for": "not-an-ip" },
      socket: { remoteAddress: "::ffff:127.0.0.1" },
    };
    expect(getClientIp(req)).toBe("127.0.0.1");
  });
});

describe("hashPassword", () => {
  test("returns salt:hash format", () => {
    const result = hashPassword("password123");
    expect(result).toMatch(/^[a-f0-9]{32}:[a-f0-9]{128}$/);
  });

  test("generates different hashes for same password", () => {
    const hash1 = hashPassword("password123");
    const hash2 = hashPassword("password123");
    expect(hash1).not.toBe(hash2);
  });

  test("uses provided salt", () => {
    const salt = "a".repeat(32);
    const result = hashPassword("password123", salt);
    expect(result).toMatch(/^a{32}:/);
  });
});

describe("verifyPassword", () => {
  test("returns true for correct password", () => {
    const hash = hashPassword("password123");
    expect(verifyPassword("password123", hash)).toBe(true);
  });

  test("returns false for incorrect password", () => {
    const hash = hashPassword("password123");
    expect(verifyPassword("wrongpassword", hash)).toBe(false);
  });

  test("returns false for null/undefined inputs", () => {
    expect(verifyPassword(null, "hash")).toBe(false);
    expect(verifyPassword("password", null)).toBe(false);
    expect(verifyPassword("", "hash")).toBe(false);
    expect(verifyPassword("password", "")).toBe(false);
  });

  test("returns false for invalid hash format", () => {
    expect(verifyPassword("password", "invalid")).toBe(false);
    expect(verifyPassword("password", "no-colon")).toBe(false);
  });
});

describe("cookies / extractToken", () => {
  test("parseCookies splits cookie header", () => {
    const req = { headers: { cookie: `${SESSION_COOKIE}=abc%20123; other=1` } };
    expect(parseCookies(req)[SESSION_COOKIE]).toBe("abc 123");
    expect(parseCookies(req).other).toBe("1");
  });

  test("extractToken prefers cookie over header", () => {
    const req = {
      headers: {
        cookie: `${SESSION_COOKIE}=cookie-token`,
        "x-auth-token": "header-token",
      },
      url: "/api/test",
    };
    expect(extractToken(req)).toBe("cookie-token");
  });

  test("extractToken falls back to header", () => {
    const req = {
      headers: { "x-auth-token": "header-token" },
      url: "/api/test",
    };
    expect(extractToken(req)).toBe("header-token");
  });

  test("does not accept a token in a normal HTTP URL", () => {
    const req = { headers: {}, url: "/api/session?token=url-token" };
    expect(extractToken(req)).toBe("");
  });

  test("accepts a URL token only when the caller explicitly allows it", () => {
    const req = { headers: {}, url: "/api/event?token=url-token" };
    expect(extractToken(req, { allowQueryToken: true })).toBe("url-token");
  });

  test("buildSessionCookie is HttpOnly + SameSite=Lax", () => {
    const c = buildSessionCookie("tok", 1000);
    expect(c).toContain(`${SESSION_COOKIE}=tok`);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Max-Age=1");
  });

  test("buildClearSessionCookie expires cookie", () => {
    expect(buildClearSessionCookie()).toContain("Max-Age=0");
  });
});

describe("checkCsrf", () => {
  test("allows GET without origin", () => {
    const req = {
      method: "GET",
      headers: { cookie: `${SESSION_COOKIE}=t`, host: "example.com" },
    };
    const res = { writeHead: vi.fn(), end: vi.fn() };
    expect(checkCsrf(req, res)).toBe(true);
  });

  test("allows POST without cookie (header auth)", () => {
    const req = {
      method: "POST",
      headers: { host: "example.com", "x-auth-token": "t" },
    };
    const res = { writeHead: vi.fn(), end: vi.fn() };
    expect(checkCsrf(req, res)).toBe(true);
  });

  test("blocks cookie POST with bad origin", () => {
    const req = {
      method: "POST",
      headers: {
        cookie: `${SESSION_COOKIE}=t`,
        host: "example.com",
        origin: "https://evil.com",
        "x-forwarded-proto": "https",
      },
    };
    const res = { writeHead: vi.fn(), end: vi.fn() };
    expect(checkCsrf(req, res)).toBe(false);
    expect(res.writeHead).toHaveBeenCalledWith(403, {
      "Content-Type": "application/json",
    });
  });

  test("allows cookie POST with matching origin", () => {
    const req = {
      method: "POST",
      headers: {
        cookie: `${SESSION_COOKIE}=t`,
        host: "example.com",
        origin: "http://example.com",
      },
    };
    const res = { writeHead: vi.fn(), end: vi.fn() };
    expect(checkCsrf(req, res)).toBe(true);
  });
});

describe("isSessionExpired", () => {
  test("uses the same strict greater-than TTL boundary", () => {
    const now = 1_000_000;
    expect(
      isSessionExpired(
        { email: "u@example.com", createdAt: now - 1_001 },
        1_000,
        now,
      ),
    ).toBe(true);
    expect(
      isSessionExpired(
        { email: "u@example.com", createdAt: now - 1_000 },
        1_000,
        now,
      ),
    ).toBe(false);
  });

  test("does not expire sessions when TTL is disabled", () => {
    expect(
      isSessionExpired({ email: "u@example.com", createdAt: 0 }, 0, 1_000_000),
    ).toBe(false);
  });
});

describe("getUserEmail", () => {
  test("returns email for valid token", () => {
    saveJson(sessionsFile, {
      token123: { email: "test@example.com", createdAt: Date.now() },
    });

    const req = { headers: { "x-auth-token": "token123" }, url: "/api/test" };
    const result = getUserEmail(req, sessionsFile, 7 * 24 * 60 * 60 * 1000);

    expect(result).toBe("test@example.com");
  });

  test("returns email from HttpOnly cookie", () => {
    saveJson(sessionsFile, {
      "cookie-tok": { email: "cookie@example.com", createdAt: Date.now() },
    });
    const req = {
      headers: { cookie: `${SESSION_COOKIE}=cookie-tok` },
      url: "/api/test",
    };
    expect(getUserEmail(req, sessionsFile, 7 * 24 * 60 * 60 * 1000)).toBe(
      "cookie@example.com",
    );
  });

  test("returns null for invalid token", () => {
    saveJson(sessionsFile, {});

    const req = { headers: { "x-auth-token": "invalid" }, url: "/api/test" };
    const result = getUserEmail(req, sessionsFile, 7 * 24 * 60 * 60 * 1000);

    expect(result).toBeNull();
  });

  test("returns null for expired session", () => {
    saveJson(sessionsFile, {
      token123: {
        email: "test@example.com",
        createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
      },
    });

    const req = { headers: { "x-auth-token": "token123" }, url: "/api/test" };
    const result = getUserEmail(req, sessionsFile, 7 * 24 * 60 * 60 * 1000);

    expect(result).toBeNull();
  });

  test("does not authenticate ordinary requests from a query-string token", () => {
    saveJson(sessionsFile, {
      token123: { email: "test@example.com", createdAt: Date.now() },
    });

    const req = { headers: {}, url: "/api/test?token=token123" };
    const result = getUserEmail(req, sessionsFile, 7 * 24 * 60 * 60 * 1000);

    expect(result).toBeNull();
  });
});

describe("checkAuth", () => {
  test("returns true for valid token", () => {
    saveJson(sessionsFile, {
      token123: { email: "test@example.com", createdAt: Date.now() },
    });
    saveJson(usersFile, { "test@example.com": { email: "test@example.com" } });

    const req = { headers: { "x-auth-token": "token123" }, url: "/api/test" };
    const res = { writeHead: vi.fn(), end: vi.fn() };

    const result = checkAuth(
      req,
      res,
      usersFile,
      sessionsFile,
      7 * 24 * 60 * 60 * 1000,
    );

    expect(result).toBe(true);
    expect(res.writeHead).not.toHaveBeenCalled();
  });

  test("returns 401 for invalid token when users exist", () => {
    saveJson(sessionsFile, {});
    saveJson(usersFile, { "test@example.com": { email: "test@example.com" } });

    const req = { headers: { "x-auth-token": "invalid" }, url: "/api/test" };
    const res = { writeHead: vi.fn(), end: vi.fn() };

    const result = checkAuth(
      req,
      res,
      usersFile,
      sessionsFile,
      7 * 24 * 60 * 60 * 1000,
    );

    expect(result).toBe(false);
    expect(res.writeHead).toHaveBeenCalledWith(401, {
      "Content-Type": "application/json",
    });
  });

  test("returns true for non-API endpoint when no users exist", () => {
    saveJson(usersFile, {});

    const req = { headers: {}, url: "/static/test" };
    const res = { writeHead: vi.fn(), end: vi.fn() };

    const result = checkAuth(
      req,
      res,
      usersFile,
      sessionsFile,
      7 * 24 * 60 * 60 * 1000,
    );

    expect(result).toBe(true);
  });

  test("returns 401 for API endpoint when no users exist", () => {
    saveJson(usersFile, {});

    const req = { headers: {}, url: "/api/test" };
    const res = { writeHead: vi.fn(), end: vi.fn() };

    const result = checkAuth(
      req,
      res,
      usersFile,
      sessionsFile,
      7 * 24 * 60 * 60 * 1000,
    );

    expect(result).toBe(false);
    expect(res.writeHead).toHaveBeenCalledWith(401, {
      "Content-Type": "application/json",
    });
  });
});

describe("rate limiting", () => {
  test("allows requests under limit", async () => {
    const req = { socket: { remoteAddress: "127.0.0.1" } };
    const res = { writeHead: vi.fn(), end: vi.fn() };

    for (let i = 0; i < 10; i++) {
      expect(await checkAuthRateLimit(req, res)).toBe(true);
    }
  });

  test("blocks requests over limit", async () => {
    const req = { socket: { remoteAddress: "192.168.1.1" } };
    const res = { writeHead: vi.fn(), end: vi.fn() };

    for (let i = 0; i < 10; i++) {
      await checkAuthRateLimit(req, res);
    }

    expect(await checkAuthRateLimit(req, res)).toBe(false);
    expect(res.writeHead).toHaveBeenCalledWith(
      429,
      expect.objectContaining({ "Content-Type": "application/json" }),
    );
  });

  test("resets rate limit for IP", async () => {
    const req = { socket: { remoteAddress: "10.0.0.1" } };
    const res = { writeHead: vi.fn(), end: vi.fn() };

    for (let i = 0; i < 10; i++) {
      await checkAuthRateLimit(req, res);
    }

    await resetAuthRateLimit(req);
    expect(await checkAuthRateLimit(req, res)).toBe(true);
  });
});

describe("isAdmin", () => {
  afterEach(() => {
    delete process.env.OPENCODE_ADMIN_EMAILS;
  });

  test("returns false for unknown / null email", () => {
    expect(isAdmin(null, usersFile)).toBe(false);
    expect(isAdmin("nobody@example.com", usersFile)).toBe(false);
  });

  test("returns true for a user with role admin", () => {
    saveJson(usersFile, {
      "boss@example.com": { email: "boss@example.com", role: "admin" },
    });
    expect(isAdmin("boss@example.com", usersFile)).toBe(true);
  });

  test("returns false for a plain user role", () => {
    saveJson(usersFile, {
      "dev@example.com": { email: "dev@example.com", role: "user" },
    });
    expect(isAdmin("dev@example.com", usersFile)).toBe(false);
  });

  test("is case-insensitive on email", () => {
    saveJson(usersFile, {
      "boss@example.com": { email: "boss@example.com", role: "admin" },
    });
    expect(isAdmin("Boss@Example.com", usersFile)).toBe(true);
  });

  test("OPENCODE_ADMIN_EMAILS grants admin regardless of stored role", () => {
    process.env.OPENCODE_ADMIN_EMAILS =
      "override@example.com, other@example.com";
    saveJson(usersFile, {
      "override@example.com": { email: "override@example.com", role: "user" },
    });
    expect(isAdmin("override@example.com", usersFile)).toBe(true);
    expect(isAdmin("other@example.com", usersFile)).toBe(true);
    expect(isAdmin("random@example.com", usersFile)).toBe(false);
  });
});
