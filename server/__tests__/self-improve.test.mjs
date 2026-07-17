// @vitest-environment node
/**
 * Tests for server/self-improve.mjs
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  getUiDir,
  isSelfImproveEnabled,
  releaseBuildLock,
  toggleSelfImprove,
  tryAcquireBuildLock,
} from "../self-improve.mjs";

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "self-improve-test-"));
});

afterEach(() => {
  releaseBuildLock();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("getUiDir", () => {
  test("returns opencode-ui subdirectory if exists", () => {
    const uiDir = path.join(tmpDir, "opencode-ui");
    fs.mkdirSync(uiDir);
    const result = getUiDir(tmpDir);
    expect(result).toBe(uiDir);
  });

  test("returns fallback path when opencode-ui doesn't exist", () => {
    const result = getUiDir(tmpDir);
    // Fallback is either /path/opencode-ui or __dirname/../
    // Both are valid — just verify it returns a string path
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("isSelfImproveEnabled", () => {
  test("returns false when flag file doesn't exist", () => {
    expect(isSelfImproveEnabled(tmpDir)).toBe(false);
  });

  test("returns true when flag file contains 'true'", () => {
    fs.writeFileSync(path.join(tmpDir, ".self_improve_mode"), "true");
    expect(isSelfImproveEnabled(tmpDir)).toBe(true);
  });

  test("returns false when flag file contains 'false'", () => {
    fs.writeFileSync(path.join(tmpDir, ".self_improve_mode"), "false");
    expect(isSelfImproveEnabled(tmpDir)).toBe(false);
  });

  test("returns false when flag file contains other content", () => {
    fs.writeFileSync(path.join(tmpDir, ".self_improve_mode"), "maybe");
    expect(isSelfImproveEnabled(tmpDir)).toBe(false);
  });
});

describe("toggleSelfImprove", () => {
  test("creates flag file with 'true' when enabling", () => {
    toggleSelfImprove(tmpDir, true);
    const content = fs.readFileSync(
      path.join(tmpDir, ".self_improve_mode"),
      "utf8",
    );
    expect(content).toBe("true");
  });

  test("creates flag file with 'false' when disabling", () => {
    toggleSelfImprove(tmpDir, false);
    const content = fs.readFileSync(
      path.join(tmpDir, ".self_improve_mode"),
      "utf8",
    );
    expect(content).toBe("false");
  });

  test("creates directory if needed", () => {
    const subDir = path.join(tmpDir, "subdir");
    toggleSelfImprove(subDir, true);
    expect(fs.existsSync(path.join(subDir, ".self_improve_mode"))).toBe(true);
  });
});

describe("build lock", () => {
  test("is released after an operation and can be acquired again", () => {
    expect(tryAcquireBuildLock()).toBe(true);
    expect(tryAcquireBuildLock()).toBe(false);
    releaseBuildLock();
    expect(tryAcquireBuildLock()).toBe(true);
  });
});
