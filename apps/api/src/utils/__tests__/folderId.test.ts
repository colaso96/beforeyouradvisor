import { describe, expect, it } from "vitest";
import { extractDriveFolderId } from "../folderId.js";

describe("extractDriveFolderId", () => {
  it("parses /folders URLs", () => {
    expect(extractDriveFolderId("https://drive.google.com/drive/folders/abc123_DEF456")).toBe("abc123_DEF456");
  });

  it("parses query param URLs", () => {
    expect(extractDriveFolderId("https://drive.google.com/open?id=abc123_DEF456")).toBe("abc123_DEF456");
  });

  it("accepts direct ids", () => {
    expect(extractDriveFolderId("abc123_DEF456")).toBe("abc123_DEF456");
  });

  it("throws for invalid input", () => {
    expect(() => extractDriveFolderId("hello")).toThrow();
  });
});
