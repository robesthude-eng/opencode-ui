// @vitest-environment node
/**
 * Tests for server/db.mjs
 */
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { loadJson, saveJson, saveAuthJson, clearCache } from "../db.mjs";

// Create temp directory for tests
let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "db-test-"));
  clearCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadJson", () => {
  test("returns default value when file does not exist", () => {
    const result = loadJson(path.join(tmpDir, "nonexistent.json"), { default: true });
    expect(result).toEqual({ default: true });
  });

  test("loads and parses JSON file", () => {
    const file = path.join(tmpDir, "test.json");
    fs.writeFileSync(file, JSON.stringify({ key: "value" }));
    const result = loadJson(file);
    expect(result).toEqual({ key: "value" });
  });

  test("caches loaded data", () => {
    const file = path.join(tmpDir, "test.json");
    fs.writeFileSync(file, JSON.stringify({ key: "value" }));

    const result1 = loadJson(file);
    fs.writeFileSync(file, JSON.stringify({ key: "changed" }));
    const result2 = loadJson(file);

    // Should return cached value
    expect(result1).toEqual(result2);
    expect(result2).toEqual({ key: "value" });
  });

  test("returns default on invalid JSON", () => {
    const file = path.join(tmpDir, "invalid.json");
    fs.writeFileSync(file, "not json");
    const result = loadJson(file, { fallback: true });
    expect(result).toEqual({ fallback: true });
  });
});

describe("saveJson", () => {
  test("writes JSON to file", () => {
    const file = path.join(tmpDir, "test.json");
    saveJson(file, { key: "value" });

    const content = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(content).toEqual({ key: "value" });
  });

  test("creates directory if needed", () => {
    const file = path.join(tmpDir, "subdir", "test.json");
    saveJson(file, { key: "value" });

    expect(fs.existsSync(file)).toBe(true);
  });

  test("updates cache", () => {
    const file = path.join(tmpDir, "test.json");
    saveJson(file, { key: "value" });

    const cached = loadJson(file);
    expect(cached).toEqual({ key: "value" });
  });

  test("sets restrictive file permissions", () => {
    const file = path.join(tmpDir, "test.json");
    saveJson(file, { key: "value" });

    const stats = fs.statSync(file);
    const mode = (stats.mode & 0o777).toString(8);
    expect(mode).toBe("600");
  });
});

describe("saveAuthJson", () => {
  test("is an alias for saveJson", () => {
    const file = path.join(tmpDir, "auth.json");
    saveAuthJson(file, { user: "test" });

    const content = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(content).toEqual({ user: "test" });
  });
});

describe("clearCache", () => {
  test("clears the cache", () => {
    const file = path.join(tmpDir, "test.json");
    fs.writeFileSync(file, JSON.stringify({ key: "value" }));

    loadJson(file); // Cache it
    clearCache();
    fs.writeFileSync(file, JSON.stringify({ key: "changed" }));

    const result = loadJson(file);
    expect(result).toEqual({ key: "changed" });
  });
});