import { describe, expect, it } from "vitest";
import { handleSandboxRequest } from "../sandbox.mjs";

describe("Pluggable Sandbox System", () => {
  it("should export the sandbox handler function", () => {
    expect(handleSandboxRequest).toBeTypeOf("function");
  });
});
