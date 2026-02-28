import { describe, expect, it } from "vitest";
import { pickAdapter } from "../ingestionService.js";

describe("ingestionService adapter selection", () => {
  it("detects AMEX from CSV headers even when file name is generic", () => {
    const adapter = pickAdapter(
      { id: "f-1", name: "statement.csv", mimeType: "text/csv" },
      [{ Date: "12/06/2025", Description: "AUTOPAY PAYMENT - THANK YOU", Amount: "-98.51" }],
    );

    expect(adapter).toBe("AMEX");
  });

  it("detects CHASE from CSV headers even when file name is generic", () => {
    const adapter = pickAdapter(
      { id: "f-2", name: "statement.csv", mimeType: "text/csv" },
      [{ "Transaction Date": "12/29/2025", Description: "Spotify USA", Amount: "-12.78", Type: "Sale" }],
    );

    expect(adapter).toBe("CHASE");
  });

  it("always maps PDFs to COINBASE adapter", () => {
    const adapter = pickAdapter({ id: "f-3", name: "whatever.pdf", mimeType: "application/pdf" });
    expect(adapter).toBe("COINBASE");
  });
});
