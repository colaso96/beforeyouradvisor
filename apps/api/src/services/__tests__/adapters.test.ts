import { describe, expect, it } from "vitest";
import { normalizeAmexCsv, normalizeChaseCsv, normalizeCoinbasePdf } from "../adapters.js";

describe("adapters", () => {
  it("normalizes chase signs and skips credits", () => {
    const rows = normalizeChaseCsv("user-1", [
      { "Transaction Date": "2025-01-02", Description: "Coffee", Amount: "-7.34" },
      { "Transaction Date": "2025-01-03", Description: "Refund", Amount: "10.00" },
      { "Transaction Date": "12/19/2025", Description: "Uber Trip", Amount: "-49.8" },
      { Date: "01/11/2025", Description: "SPARROW WINE & LIQUOR", Amount: "26.64" },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.transactionType).toBe("DEBIT");
    expect(rows[1]?.transactionType).toBe("DEBIT");
    expect(rows[0]?.amount).toBe("7.34");
    expect(rows[1]?.date).toBe("2025-12-19");
  });

  it("skips invalid chase rows instead of failing entire file", () => {
    const rows = normalizeChaseCsv("user-1", [
      { "Transaction Date": "2025-01-02", Description: "Coffee", Amount: "-7.34" },
      { Description: "Broken row", Amount: "167.36" },
      { "Transaction Date": "2025-01-03", Description: "Refund", Amount: "10.00" },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.description).toBe("Coffee");
  });

  it("normalizes amex signs and skips credits", () => {
    const rows = normalizeAmexCsv("user-1", [
      { Date: "2025-01-02", Description: "Software", Amount: "15.00" },
      { Date: "2025-01-03", Description: "Payment", Amount: "-99.99" },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.transactionType).toBe("DEBIT");
  });

  it("normalizes coinbase pdf rows and skips credits", () => {
    const rows = normalizeCoinbasePdf("user-1", [
      { Date: "2025-01-02", Description: "BTC Buy", Amount: "$100.00" },
      { Date: "2025-01-03", Description: "Payment", Amount: "-$50.00" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.institution).toBe("COINBASE");
    expect(rows[0]?.transactionType).toBe("DEBIT");
  });
});
