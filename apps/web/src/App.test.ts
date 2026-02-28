import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("App submission flow content", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf-8");

  it("includes the primary workflow stages from submission flow", () => {
    expect(appSource).toContain("1. Link Data (Google Drive)");
    expect(appSource).toContain("2. Business Profile");
    expect(appSource).toContain("3. Run AI Analysis");
    expect(appSource).toContain("Transactions");
    expect(appSource).toContain("Category Totals");
  });

  it("includes chat with data card and places it above the transactions card", () => {
    const chatIdx = appSource.indexOf("Data Agent Chat");
    const transactionsIdx = appSource.indexOf("<h2>Transactions</h2>");
    expect(chatIdx).toBeGreaterThan(-1);
    expect(transactionsIdx).toBeGreaterThan(-1);
    expect(chatIdx).toBeLessThan(transactionsIdx);
  });

  it("requires at least two transactions before chat usage", () => {
    expect(appSource).toContain("Requires at least 2 transaction rows");
    expect(appSource).toContain("At least 2 transaction rows are required before using chat.");
    expect(appSource).toContain("Eligible: {chatEligibility.eligible ? \"Yes\" : \"No\"}");
  });

  it("preserves chat messages across hide/show toggles in-session", () => {
    expect(appSource).toContain("const [chatInitialized, setChatInitialized] = useState(false);");
    expect(appSource).toContain("if (next && !chatInitialized)");
    expect(appSource).not.toContain("setChatMessages([]);\n                  if (next)");
  });
});
