// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createDbBackup, getBackupDir, listDbBackups, resolveBackupFile } from "../backup.mjs";
import { clearCache, closeDb, initDb, saveJson } from "../db.mjs";

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-test-"));
  closeDb();
  clearCache();
  initDb(tmpDir);
  // seed a user so DB has content
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
  clearCache();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("createDbBackup", () => {
  test("creates a backup file under backups/", () => {
    const r = createDbBackup(tmpDir);
    expect(r.name).toMatch(/^opencode-.*\.db$/);
    expect(fs.existsSync(r.path)).toBe(true);
    expect(r.bytes).toBeGreaterThan(0);
    expect(getBackupDir(tmpDir)).toBe(path.join(tmpDir, "backups"));
  });

  test("listDbBackups returns newest first", () => {
    createDbBackup(tmpDir);
    createDbBackup(tmpDir);
    const list = listDbBackups(tmpDir);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list[0].mtime).toBeGreaterThanOrEqual(list[1].mtime);
  });

  test("resolveBackupFile blocks path traversal", () => {
    const r = createDbBackup(tmpDir);
    expect(resolveBackupFile(tmpDir, r.name)).toBeTruthy();
    expect(resolveBackupFile(tmpDir, "../opencode.db")).toBeNull();
    expect(resolveBackupFile(tmpDir, "evil.db")).toBeNull();
    expect(resolveBackupFile(tmpDir, "opencode-../../x.db")).toBeNull();
  });
});
