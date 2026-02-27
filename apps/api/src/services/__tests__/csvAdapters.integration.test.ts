import { describe, expect, it } from "vitest";
import { AMEX_FIXTURE_PATH, CHASE_FIXTURE_PATH, hasAmexFixture, hasChaseFixture, loadAmexFixture, loadChaseFixture } from "./integrationFixtures.js";

describe("CSV adapter integrations", () => {
  const chaseTest = hasChaseFixture() ? it : it.skip;
  const amexTest = hasAmexFixture() ? it : it.skip;

  chaseTest("parses and normalizes a Chase CSV fixture", async () => {
    const { rawRows, normalizedRows } = await loadChaseFixture("integration-test-user");

    console.info(`[chase-csv-integration] fixture=${CHASE_FIXTURE_PATH}`);
    console.info(`[chase-csv-integration] parsed=${rawRows.length}, normalized=${normalizedRows.length}`);
    console.table(rawRows.slice(0, 30));
    console.table(normalizedRows.slice(0, 30));

    expect(rawRows.length).toBe(30);
    expect(normalizedRows.length).toBe(26);
    expect(normalizedRows.every((row) => row.institution === "CHASE")).toBe(true);
    expect(normalizedRows.every((row) => row.transactionType === "DEBIT")).toBe(true);
  });

  amexTest("parses and normalizes an Amex CSV fixture", async () => {
    const { rawRows, normalizedRows } = await loadAmexFixture("integration-test-user");

    console.info(`[amex-csv-integration] fixture=${AMEX_FIXTURE_PATH}`);
    console.info(`[amex-csv-integration] parsed=${rawRows.length}, normalized=${normalizedRows.length}`);
    console.table(rawRows.slice(0, 30));
    console.table(normalizedRows.slice(0, 30));

    expect(rawRows.length).toBe(30);
    expect(normalizedRows.length).toBe(24);
    expect(normalizedRows.every((row) => row.institution === "AMEX")).toBe(true);
    expect(normalizedRows.every((row) => row.transactionType === "DEBIT")).toBe(true);
  });
});
