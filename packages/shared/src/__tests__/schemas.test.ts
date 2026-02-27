import { describe, expect, it } from "vitest";
import { analysisResultSchema, analysisStartSchema, profileSchema } from "../index.js";

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
});
