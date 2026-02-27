import { describe, expect, it } from "vitest";
import { parseCoinbaseStatementText } from "../coinbasePdfService.js";

describe("parseCoinbaseStatementText", () => {
  it("extracts only transaction rows while skipping payment and statement noise", () => {
    const sample = `
Payments and credits
Date Description Amount
Oct 17, 2025 ACH PAYMENT -$2,481.99
Total payments and credits in this period -$2,481.99
Transactions
Date Description Amount
Oct 4, 2025 TST* OFF THE RAILS LLC 0 64 POND ST LUDLOW
05149 105 840
$10.21
Oct 8, 2025 TST* BRONX DRAFTHOUSE 00 884 GERARD AVE
THE BRONX 10452 092 840
$22.30
Coinbase One Card is offered through Coinbase, Inc. and Cardless, Inc. Cards issued by First Electronic Bank. Page 2 of 10
    `;

    const rows = parseCoinbaseStatementText(sample);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.Date).toBe("Oct 4, 2025");
    expect(rows[0]?.Description).toContain("TST* OFF THE RAILS LLC");
    expect(rows[0]?.Amount).toBe("$10.21");
  });

  it("stops parsing transactions before legal/disclosure sections", () => {
    const sample = `
Transactions
Date Description Amount
Dec 19, 2025 NYCT PAYGO 2 BROADWAY NEW YORK 10004 092 840
$2.90
Total new charges in this period
Fees - Total fees charged in this period
Interest charged - Total interest for this period
Year-to-date summary
Interest charge calculation
Important disclosures
Billing Rights Summary
What To Do If You Think You Find A Mistake On Your Statement:
`;

    const rows = parseCoinbaseStatementText(sample);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      Date: "Dec 19, 2025",
      Description: "NYCT PAYGO 2 BROADWAY NEW YORK 10004 092 840",
      Amount: "$2.90",
    });
  });

  it("truncates inline legal text attached to a transaction line", () => {
    const sample = `
Transactions
Date Description Amount
Dec 3, 2025 NYCT PAYGO 2 BROADWAY NEW YORK 10004 092 840 Total new charges in this period Important disclosures $2.90
Total transactions in this period $2.90
`;

    const rows = parseCoinbaseStatementText(sample);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      Date: "Dec 3, 2025",
      Description: "NYCT PAYGO 2 BROADWAY NEW YORK 10004 092 840",
      Amount: "$2.90",
    });
  });
});
