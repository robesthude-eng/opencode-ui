// @vitest-environment node
/**
 * Tests for server/db.mjs — SQLite auth store + JSON fallback
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  clearCache,
  closeDb,
  getSqlite,
  initDb,
  loadJson,
  saveAuthJson,
  saveJson,
} from "../db.mjs";

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "db-test-"));
  closeDb();
  clearCache();
  initDb(tmpDir);
});

afterEach(() => {
  closeDb();
  clearCache();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadJson / saveJson (non-auth files)", () => {
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
    expect(result1).toEqual(result2);
    expect(result2).toEqual({ key: "value" });
  });

  test("returns default on invalid JSON", () => {
    const file = path.join(tmpDir, "invalid.json");
    fs.writeFileSync(file, "not json");
    const result = loadJson(file, { fallback: true });
    expect(result).toEqual({ fallback: true });
  });

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
    expect(loadJson(file)).toEqual({ key: "value" });
  });

  test("sets restrictive file permissions", () => {
    const file = path.join(tmpDir, "test.json");
    saveJson(file, { key: "value" });
    const stats = fs.statSync(file);
    const mode = (stats.mode & 0o777).toString(8);
    expect(mode).toBe("600");
  });
});

describe("SQLite auth store", () => {
  test("saves and loads users via logical .users.json path", () => {
    const file = path.join(tmpDir, ".users.json");
    saveJson(file, {
      "a@example.com": {
        email: "a@example.com",
        passwordHash: "salt:hash",
        role: "admin",
        createdAt: 123,
      },
    });
    clearCache();
    const users = loadJson(file, {});
    expect(users["a@example.com"].passwordHash).toBe("salt:hash");
    expect(users["a@example.com"].role).toBe("admin");
    expect(getSqlite()).toBeTruthy();
  });

  test("saves and loads sessions", () => {
    const file = path.join(tmpDir, ".sessions.json");
    saveJson(file, {
      tok1: { email: "a@example.com", createdAt: 1 },
      tok2: { email: "b@example.com", createdAt: 2 },
    });
    clearCache();
    const sessions = loadJson(file, {});
    expect(Object.keys(sessions)).toHaveLength(2);
    expect(sessions.tok1.email).toBe("a@example.com");
  });

  test("saves and loads session owners", () => {
    const file = path.join(tmpDir, ".session_owners.json");
    saveJson(file, { ses_1: "a@example.com" });
    clearCache();
    expect(loadJson(file, {})).toEqual({ ses_1: "a@example.com" });
  });

  test("migrates legacy JSON on init", () => {
    closeDb();
    clearCache();
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "db-migrate-"));
    fs.writeFileSync(
      path.join(work, ".users.json"),
      JSON.stringify({
        "legacy@example.com": {
          email: "legacy@example.com",
          passwordHash: "x:y",
          role: "user",
          createdAt: 99,
        },
      }),
    );
    fs.writeFileSync(
      path.join(work, ".sessions.json"),
      JSON.stringify({ legtok: { email: "legacy@example.com", createdAt: 100 } }),
    );
    initDb(work);
    const users = loadJson(path.join(work, ".users.json"), {});
    const sessions = loadJson(path.join(work, ".sessions.json"), {});
    expect(users["legacy@example.com"].passwordHash).toBe("x:y");
    expect(sessions.legtok.email).toBe("legacy@example.com");
    expect(fs.existsSync(path.join(work, ".sqlite_migrated"))).toBe(true);
    closeDb();
    fs.rmSync(work, { recursive: true, force: true });
  });
});

describe("saveAuthJson", () => {
  test("is an alias for saveJson", () => {
    const file = path.join(tmpDir, ".users.json");
    saveAuthJson(file, {
      "u@example.com": {
        email: "u@example.com",
        passwordHash: "a:b",
        role: "user",
        createdAt: 1,
      },
    });
    clearCache();
    expect(loadJson(file, {})["u@example.com"].role).toBe("user");
  });
});

describe("clearCache", () => {
  test("clears the cache for disk files", () => {
    const file = path.join(tmpDir, "test.json");
    fs.writeFileSync(file, JSON.stringify({ key: "value" }));
    loadJson(file);
    clearCache();
    fs.writeFileSync(file, JSON.stringify({ key: "changed" }));
    expect(loadJson(file)).toEqual({ key: "changed" });
  });
});
