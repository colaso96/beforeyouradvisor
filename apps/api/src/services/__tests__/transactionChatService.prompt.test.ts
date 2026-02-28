import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("transaction chat prompt style guards", () => {
  const source = readFileSync(resolve(process.cwd(), "src/services/transactionChatService.ts"), "utf-8");

  it("includes narrative-summary instruction by default", () => {
    expect(source).toContain("Default to natural-language insight summaries");
    expect(source).toContain("not row-by-row log formatting");
  });

  it("allows row-level detail when explicitly requested", () => {
    expect(source).toContain("userRequestedRowLevelDetails");
    expect(source).toContain("The user explicitly asked for row-level fields");
  });
});
