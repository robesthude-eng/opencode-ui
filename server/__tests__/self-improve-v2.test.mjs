// @vitest-environment node
/**
 * P1.3 Tests for self-improve v2 transaction
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { clearCache, closeDb } from "../db.mjs";
import {
  confirmProposal,
  createProposal,
  getProposal,
  listProposals,
  markProposalStatus,
} from "../self-improve-v2.mjs";

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "si-v2-test-"));
  closeDb();
  clearCache();
});

afterEach(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  clearCache();
});

describe("self-improve v2 proposal", () => {
  test("creates proposal with hash and TTL", () => {
    const files = [
      { path: "src/components/Test.tsx", content: "export const Test = () => <div>hi</div>" },
    ];
    const proposal = createProposal(tmpDir, {
      files,
      baseCommit: "abc123",
      userEmail: "admin@example.com",
    });
    expect(proposal.id).toMatch(/^prp_/);
    expect(proposal.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(proposal.status).toBe("proposal");
    expect(proposal.files).toEqual(["src/components/Test.tsx"]);
    expect(proposal.expiresAt).toBeGreaterThan(Date.now());
  });

  test("rejects file paths outside src/** at creation time", () => {
    expect(() =>
      createProposal(tmpDir, {
        files: [{ path: "package.json", content: "{}" }],
        baseCommit: "abc",
        userEmail: "a@b.com",
      }),
    ).toThrow(/src\//);
  });

  test("rejects path traversal at creation time", () => {
    expect(() =>
      createProposal(tmpDir, {
        files: [{ path: "src/../server/index.mjs", content: "evil" }],
        baseCommit: "abc",
        userEmail: "a@b.com",
      }),
    ).toThrow(/traversal/);
  });

  test("rejects empty files array at creation time", () => {
    expect(() =>
      createProposal(tmpDir, { files: [], baseCommit: "abc", userEmail: "a@b.com" }),
    ).toThrow(/files array/);
  });

  test("hash is deterministic for same files", () => {
    const files = [{ path: "src/a.ts", content: "content" }];
    const p1 = createProposal(tmpDir, { files, baseCommit: "abc", userEmail: "a@b.com" });
    const p2 = createProposal(tmpDir, { files, baseCommit: "abc", userEmail: "a@b.com" });
    expect(p1.hash).toBe(p2.hash);
  });

  test("hash differs for different content", () => {
    const files1 = [{ path: "src/a.ts", content: "content1" }];
    const files2 = [{ path: "src/a.ts", content: "content2" }];
    const p1 = createProposal(tmpDir, { files: files1, baseCommit: "abc", userEmail: "a@b.com" });
    const p2 = createProposal(tmpDir, { files: files2, baseCommit: "abc", userEmail: "a@b.com" });
    expect(p1.hash).not.toBe(p2.hash);
  });

  test("getProposal returns stored proposal", () => {
    const files = [{ path: "src/a.ts", content: "hi" }];
    const created = createProposal(tmpDir, { files, baseCommit: "abc", userEmail: "a@b.com" });
    const fetched = getProposal(tmpDir, created.id);
    expect(fetched).not.toBeNull();
    expect(fetched.id).toBe(created.id);
    expect(fetched.hash).toBe(created.hash);
  });

  test("confirmProposal with correct hash succeeds", () => {
    const files = [{ path: "src/a.ts", content: "hi" }];
    const proposal = createProposal(tmpDir, { files, baseCommit: "abc", userEmail: "a@b.com" });
    const confirmed = confirmProposal(tmpDir, {
      proposalId: proposal.id,
      hash: proposal.hash,
      userEmail: "a@b.com",
    });
    expect(confirmed.status).toBe("confirmed");
  });

  test("confirmProposal with wrong hash fails", () => {
    const files = [{ path: "src/a.ts", content: "hi" }];
    const proposal = createProposal(tmpDir, { files, baseCommit: "abc", userEmail: "a@b.com" });
    expect(() =>
      confirmProposal(tmpDir, { proposalId: proposal.id, hash: "wronghash", userEmail: "a@b.com" }),
    ).toThrow(/Hash mismatch/);
  });

  test("proposal TTL 15min", () => {
    const files = [{ path: "src/a.ts", content: "hi" }];
    const proposal = createProposal(tmpDir, { files, baseCommit: "abc", userEmail: "a@b.com" });
    expect(proposal.ttl).toBe(15 * 60 * 1000);
    expect(proposal.expiresAt - proposal.createdAt).toBe(15 * 60 * 1000);
  });

  test("listProposals returns recent", () => {
    const files = [{ path: "src/a.ts", content: "hi" }];
    createProposal(tmpDir, { files, baseCommit: "a", userEmail: "a@b.com" });
    createProposal(tmpDir, { files, baseCommit: "b", userEmail: "b@b.com" });
    const list = listProposals(tmpDir);
    expect(list.length).toBe(2);
  });

  test("markProposalStatus updates status", () => {
    const files = [{ path: "src/a.ts", content: "hi" }];
    const proposal = createProposal(tmpDir, { files, baseCommit: "abc", userEmail: "a@b.com" });
    const updated = markProposalStatus(tmpDir, proposal.id, "applying");
    expect(updated.status).toBe("applying");
  });

  test("single-use: confirmed proposal cannot be re-confirmed", () => {
    const files = [{ path: "src/a.ts", content: "hi" }];
    const proposal = createProposal(tmpDir, { files, baseCommit: "abc", userEmail: "a@b.com" });
    confirmProposal(tmpDir, { proposalId: proposal.id, hash: proposal.hash, userEmail: "a@b.com" });
    expect(() =>
      confirmProposal(tmpDir, {
        proposalId: proposal.id,
        hash: proposal.hash,
        userEmail: "a@b.com",
      }),
    ).toThrow(/already.*confirmable/i);
  });
});
