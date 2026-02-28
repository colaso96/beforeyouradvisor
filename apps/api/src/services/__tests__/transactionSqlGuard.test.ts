import { describe, expect, it } from "vitest";
import { validateGeneratedSql, wrapWithLimit100 } from "../transactionSqlGuard.js";

describe("transactionSqlGuard", () => {
  it("accepts read-only SQL with explicit user filter", () => {
    const sql = validateGeneratedSql("SELECT description, amount FROM transactions WHERE user_id = $1 ORDER BY amount DESC");
    expect(sql).toContain("user_id = $1");
  });

  it("allows CTE select queries", () => {
    const sql = validateGeneratedSql(`
      WITH scoped AS (
        SELECT * FROM transactions WHERE user_id = $1
      )
      SELECT institution, SUM(amount) AS total
      FROM scoped
      GROUP BY institution
    `);
    expect(sql.toLowerCase()).toContain("with scoped");
  });

  it("rejects SQL without user filter", () => {
    expect(() => validateGeneratedSql("SELECT * FROM transactions ORDER BY amount DESC")).toThrow("user_id = $1");
  });

  it("rejects forbidden write operations", () => {
    expect(() => validateGeneratedSql("DELETE FROM transactions WHERE user_id = $1")).toThrow("SELECT or WITH");
  });

  it("rejects unsupported bind variables", () => {
    expect(() => validateGeneratedSql("SELECT * FROM transactions WHERE user_id = $1 AND amount > $2")).toThrow("Only bind variable $1");
  });

  it("wraps validated SQL with 100-row limit", () => {
    const wrapped = wrapWithLimit100("SELECT * FROM transactions WHERE user_id = $1");
    expect(wrapped).toBe("SELECT * FROM (SELECT * FROM transactions WHERE user_id = $1) AS user_query LIMIT 100");
  });
});
