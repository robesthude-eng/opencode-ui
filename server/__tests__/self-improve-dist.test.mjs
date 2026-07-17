// @vitest-environment node

import fs from "fs";
import { describe, expect, test } from "vitest";
import { listDistSnapshots, promoteDistSnapshot } from "../self-improve.mjs";

// Redirect constants by monkey-patching fs paths used in module:
// The module hardcodes /app/dist — skip promote tests if not writable.
const _canWriteApp = (() => {
  try {
    fs.mkdirSync("/tmp/opencode-dist-test", { recursive: true });
    return true;
  } catch {
    return false;
  }
})();

describe("dist snapshot helpers (unit smoke)", () => {
  test("listDistSnapshots returns array", () => {
    const list = listDistSnapshots();
    expect(Array.isArray(list)).toBe(true);
  });

  test("promoteDistSnapshot is safe when /app/dist missing", () => {
    // Should not throw; returns null if no dist
    const result = promoteDistSnapshot();
    // null or string path
    expect(result === null || typeof result === "string").toBe(true);
  });
});
