// @vitest-environment node
/**
 * Tests for server/middleware.mjs
 */
import { describe, expect, test, vi } from "vitest";
import { checkRateLimit, readBody, setSecurityHeaders } from "../middleware.mjs";

describe("setSecurityHeaders", () => {
  test("sets all required security headers when framing is blocked", () => {
    const originalAllowFraming = process.env.ALLOW_FRAMING;
    process.env.ALLOW_FRAMING = "0";
    try {
      const res = { setHeader: vi.fn() };
      setSecurityHeaders(res);

      expect(res.setHeader).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
      expect(res.setHeader).toHaveBeenCalledWith("X-Frame-Options", "DENY");
      expect(res.setHeader).toHaveBeenCalledWith(
        "Referrer-Policy",
        "strict-origin-when-cross-origin",
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=()",
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        "Content-Security-Policy",
        expect.stringContaining("default-src 'self'"),
      );
      const cspCall = res.setHeader.mock.calls.find((c) => c[0] === "Content-Security-Policy");
      expect(cspCall[1]).toContain("connect-src");
      expect(cspCall[1]).toContain("https:");
      expect(cspCall[1]).toContain("worker-src");
      expect(cspCall[1]).toContain("frame-ancestors 'none'");
    } finally {
      if (originalAllowFraming === undefined) {
        delete process.env.ALLOW_FRAMING;
      } else {
        process.env.ALLOW_FRAMING = originalAllowFraming;
      }
    }
  });

  test("allows framing when ALLOW_FRAMING is not 0", () => {
    const originalAllowFraming = process.env.ALLOW_FRAMING;
    process.env.ALLOW_FRAMING = "1";
    try {
      const res = { setHeader: vi.fn() };
      setSecurityHeaders(res);

      expect(res.setHeader).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
      expect(res.setHeader).not.toHaveBeenCalledWith("X-Frame-Options", "DENY");
      const cspCall = res.setHeader.mock.calls.find((c) => c[0] === "Content-Security-Policy");
      expect(cspCall[1]).toContain("frame-ancestors *");
    } finally {
      if (originalAllowFraming === undefined) {
        delete process.env.ALLOW_FRAMING;
      } else {
        process.env.ALLOW_FRAMING = originalAllowFraming;
      }
    }
  });
});

describe("readBody", () => {
  test("reads body within size limit", async () => {
    const chunks = [Buffer.from("hello"), Buffer.from(" world")];
    const req = {
      on: (event, callback) => {
        if (event === "data") chunks.forEach((chunk) => callback(chunk));
        else if (event === "end") callback();
      },
      destroy: vi.fn(),
    };

    const result = await readBody(req, 100);
    expect(result.toString()).toBe("hello world");
    expect(req.destroy).not.toHaveBeenCalled();
  });

  test("destroys request when body exceeds limit", async () => {
    const req = {
      on: (event, callback) => {
        if (event === "data") {
          callback(Buffer.alloc(100));
          callback(Buffer.alloc(100));
        } else if (event === "end") callback();
      },
      destroy: vi.fn(),
    };

    await expect(readBody(req, 150)).rejects.toThrow("Body too large");
    expect(req.destroy).toHaveBeenCalled();
  });

  test("rejects on request error", async () => {
    const req = {
      on: (event, callback) => {
        if (event === "error") callback(new Error("Network error"));
      },
      destroy: vi.fn(),
    };

    await expect(readBody(req)).rejects.toThrow("Network error");
  });
});

describe("checkRateLimit", () => {
  test("allows first request", () => {
    const res = { writeHead: vi.fn(), end: vi.fn() };
    // Use a unique mock to avoid state leakage
    expect(checkRateLimit(res)).toBe(true);
    expect(res.writeHead).not.toHaveBeenCalled();
  });
});
