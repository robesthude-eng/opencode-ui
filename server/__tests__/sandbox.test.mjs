// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import {
  handleSandboxRequest,
  normalizeSandboxPath,
  releaseSandboxRun,
  resolveInside,
  tryAcquireSandboxRun,
  validateSandboxFiles,
} from "../sandbox.mjs";

afterEach(() => releaseSandboxRun());

describe("sandbox path boundary", () => {
  it("exports the sandbox handler", () => {
    expect(handleSandboxRequest).toBeTypeOf("function");
  });

  it("accepts a normal source path and normalizes separators", () => {
    expect(normalizeSandboxPath("src\\components\\Card.tsx")).toBe("src/components/Card.tsx");
  });

  it.each([
    "src/../package.json",
    "src/components/../../server/index.mjs",
    "../src/App.tsx",
    "/app/server/index.mjs",
    "server/index.mjs",
  ])("rejects traversal or paths outside src: %s", (input) => {
    expect(() => normalizeSandboxPath(input)).toThrow();
  });

  it("enforces the resolved root boundary", () => {
    expect(resolveInside("/tmp/sandbox", "src/App.tsx")).toBe("/tmp/sandbox/src/App.tsx");
    expect(() => resolveInside("/tmp/sandbox", "../outside.ts")).toThrow();
  });

  it("rejects duplicate paths and oversized file batches", () => {
    expect(() =>
      validateSandboxFiles([
        { path: "src/App.tsx", content: "a" },
        { path: "src/App.tsx", content: "b" },
      ]),
    ).toThrow("duplicate");
    expect(() =>
      validateSandboxFiles(
        Array.from({ length: 21 }, (_, index) => ({
          path: `src/file-${index}.ts`,
          content: "",
        })),
      ),
    ).toThrow("at most 20");
    expect(() =>
      validateSandboxFiles([{ path: "src/large.ts", content: "x".repeat(201 * 1024) }]),
    ).toThrow("200 KB");
  });
});

describe("sandbox run lock", () => {
  it("allows only one active sandbox run", () => {
    expect(tryAcquireSandboxRun()).toBe(true);
    expect(tryAcquireSandboxRun()).toBe(false);
    releaseSandboxRun();
    expect(tryAcquireSandboxRun()).toBe(true);
  });
});
