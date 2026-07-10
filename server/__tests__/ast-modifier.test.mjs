import { describe, expect, it } from "vitest";
import { handleASTModifyRequest } from "../ast-modifier.mjs";

describe("Pluggable AST Modifier System", () => {
  it("should export the handleASTModifyRequest function", () => {
    expect(handleASTModifyRequest).toBeTypeOf("function");
  });
});
