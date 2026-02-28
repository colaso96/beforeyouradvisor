import { describe, expect, it } from "vitest";
import {
  analysisCheckoutFinalizeSchema,
  analysisCheckoutStartSchema,
  analysisResultSchema,
  analysisStartSchema,
  profileSchema,
  transactionChatMessageSchema,
  transactionChatSendSchema,
} from "../index.js";

describe("shared schemas", () => {
  it("validates profile payload", () => {
    const parsed = profileSchema.parse({ businessType: "software_developer", aggressivenessLevel: "MODERATE" });
    expect(parsed.businessType).toBe("software_developer");
  });

  it("validates analysis response schema", () => {
    const parsed = analysisResultSchema.parse([
      {
        category: "Software",
        is_deductible: true,
        reasoning: "Business tool",
      },
    ]);

    expect(parsed[0]?.is_deductible).toBe(true);
  });

  it("validates analysis start payload with optional note", () => {
    const parsed = analysisStartSchema.parse({
      ingestionJobId: "de305d54-75b4-431b-adb2-eb6b9e546014",
      analysisNote: "look for utilities and dinner expenses to write off",
    });
    expect(parsed.analysisNote).toBe("look for utilities and dinner expenses to write off");
  });

  it("rejects analysis note above max length", () => {
    const longNote = "a".repeat(501);
    expect(() => analysisStartSchema.parse({ analysisNote: longNote })).toThrow();
  });

  it("validates checkout start payload schema", () => {
    const parsed = analysisCheckoutStartSchema.parse({
      ingestionJobId: "de305d54-75b4-431b-adb2-eb6b9e546014",
      analysisNote: "focus on software and travel",
    });
    expect(parsed.ingestionJobId).toBe("de305d54-75b4-431b-adb2-eb6b9e546014");
  });

  it("validates checkout finalize payload schema", () => {
    const parsed = analysisCheckoutFinalizeSchema.parse({
      checkoutSessionId: "cs_test_123",
    });
    expect(parsed.checkoutSessionId).toBe("cs_test_123");
  });

  it("validates chat send payload", () => {
    const parsed = transactionChatSendSchema.parse({ message: "Show my largest vendors this month" });
    expect(parsed.message).toBe("Show my largest vendors this month");
  });

  it("validates chat message response payload", () => {
    const parsed = transactionChatMessageSchema.parse({
      id: "de305d54-75b4-431b-adb2-eb6b9e546014",
      role: "assistant",
      content: "Here are your top vendors.",
      sql: "SELECT description FROM transactions WHERE user_id = $1 LIMIT 100",
      resultTable: {
        columns: ["description"],
        rows: [{ description: "Figma" }],
      },
      createdAt: "2026-02-27T18:00:00.000Z",
    });

    expect(parsed.role).toBe("assistant");
    expect(parsed.resultTable?.rows).toHaveLength(1);
  });
});
