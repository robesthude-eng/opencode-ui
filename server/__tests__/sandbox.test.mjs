// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applySourceChangesTransaction,
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
    expect(normalizeSandboxPath("src\\components\\Card.tsx")).toBe(
      "src/components/Card.tsx",
    );
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
    expect(resolveInside("/tmp/sandbox", "src/App.tsx")).toBe(
      "/tmp/sandbox/src/App.tsx",
    );
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
      validateSandboxFiles([
        { path: "src/large.ts", content: "x".repeat(201 * 1024) },
      ]),
    ).toThrow("200 KB");
  });
});

describe("source transaction", () => {
  const dirs = [];

  afterEach(() => {
    for (const dir of dirs.splice(0))
      fs.rmSync(dir, { recursive: true, force: true });
  });

  it("restores modified files and removes newly created files on rollback", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-transaction-"));
    dirs.push(root);
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src", "App.tsx"), "before");

    const rollback = applySourceChangesTransaction(root, [
      { path: "src/App.tsx", content: "after" },
      { path: "src/New.tsx", content: "new" },
    ]);
    expect(fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8")).toBe(
      "after",
    );
    expect(fs.existsSync(path.join(root, "src", "New.tsx"))).toBe(true);

    rollback();
    expect(fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8")).toBe(
      "before",
    );
    expect(fs.existsSync(path.join(root, "src", "New.tsx"))).toBe(false);
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
