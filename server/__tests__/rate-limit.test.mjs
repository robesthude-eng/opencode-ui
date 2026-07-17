// @vitest-environment node
import { afterEach, describe, expect, test, vi } from "vitest";
import { checkUserRateLimit, resetRateLimits, take } from "../rate-limit.mjs";

afterEach(() => resetRateLimits());

describe("shared rate-limit interface", () => {
  test("enforces a fixed window consistently for a key", async () => {
    const first = await take("test:fixed-window", { limit: 2, windowMs: 60_000 });
    const second = await take("test:fixed-window", { limit: 2, windowMs: 60_000 });
    const third = await take("test:fixed-window", { limit: 2, windowMs: 60_000 });

    expect(first).toMatchObject({ allowed: true, remaining: 1 });
    expect(second).toMatchObject({ allowed: true, remaining: 0 });
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSec).toBeGreaterThan(0);
  });

  test("writes Retry-After when a user/IP bucket is exhausted", async () => {
    const req = { headers: {}, socket: { remoteAddress: "203.0.113.42" } };
    const first = { writeHead: vi.fn(), end: vi.fn() };
    const limited = { writeHead: vi.fn(), end: vi.fn() };

    expect(await checkUserRateLimit(req, first, "user@example.com", { limit: 1, windowMs: 60_000 })).toBe(true);
    expect(await checkUserRateLimit(req, limited, "user@example.com", { limit: 1, windowMs: 60_000 })).toBe(false);
    expect(limited.writeHead).toHaveBeenCalledWith(429, expect.objectContaining({ "Retry-After": expect.any(String) }));
  });

  test("separates user/IP/bucket scopes", async () => {
    const opts = { limit: 1, windowMs: 60_000 };
    expect((await take("u:one|ip:127.0.0.1|heavy", opts)).allowed).toBe(true);
    expect((await take("u:two|ip:127.0.0.1|heavy", opts)).allowed).toBe(true);
    expect((await take("u:one|ip:127.0.0.1|upload", opts)).allowed).toBe(true);
  });
});
