import { describe, expect, it } from "vitest";
import { classifyTransactions } from "../llmService.js";
import { hasAmexFixture, hasChaseFixture, loadAmexFixture, loadChaseFixture } from "./integrationFixtures.js";

const SHOULD_RUN = process.env.RUN_LLM_INTEGRATION === "1";
const HAS_API_KEY = Boolean(process.env.GEMINI_API_KEY);
const HAS_FIXTURES = hasChaseFixture() && hasAmexFixture();

describe("LLM service integration", () => {
  const integrationTest = SHOULD_RUN && HAS_API_KEY && HAS_FIXTURES ? it : it.skip;

  integrationTest("classifies one 10-transaction batch from normalized integration fixtures", async () => {
    const [chase, amex] = await Promise.all([
      loadChaseFixture("integration-test-user"),
      loadAmexFixture("integration-test-user"),
    ]);

    const normalized = [...chase.normalizedRows, ...amex.normalizedRows];
    const llmCandidates = normalized.filter((row) => !row.description.toLowerCase().includes("automatic payment"));
    expect(llmCandidates.length).toBeGreaterThanOrEqual(10);

    const batch = llmCandidates.slice(0, 10).map((row) => ({
      id: row.id,
      date: row.date,
      description: row.description,
      amount: row.amount,
      institution: row.institution,
      transaction_type: row.transactionType,
    }));

    const results = await classifyTransactions({
      businessType: "software_developer",
      aggressivenessLevel: "MODERATE",
      analysisNote: "Classify likely software business expenses conservatively when ambiguous.",
      transactions: batch,
    });

    console.info(`[llm-integration] inputBatch=${batch.length}, output=${results.length}`);
    console.table(batch);
    console.table(results);

    expect(results).toHaveLength(10);
    expect(new Set(results.map((row) => row.transactionId)).size).toBe(10);
    expect(results.every((row) => typeof row.category === "string" && row.category.trim().length > 0)).toBe(true);
    expect(results.every((row) => typeof row.reasoning === "string" && row.reasoning.trim().length > 10)).toBe(true);
    expect(results.every((row) => typeof row.is_deductible === "boolean")).toBe(true);
    expect(results.every((row) => !/defaulted classification|default applied|model skipped/i.test(row.reasoning))).toBe(true);
  }, 120_000);
});

