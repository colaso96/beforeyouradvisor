const FORBIDDEN_SQL_PATTERN =
  /\b(insert|update|delete|drop|alter|truncate|grant|revoke|create|comment|analyze|vacuum|copy|call|do|execute|merge|upsert)\b/i;

function stripTrailingSemicolon(sql: string): string {
  return sql.trim().replace(/;+$/g, "").trim();
}

function assertSingleStatement(sql: string): void {
  if (sql.includes(";")) {
    throw new Error("SQL must contain only one statement.");
  }
}

function assertReadOnly(sql: string): void {
  const startsWithReadOnly = /^\s*(select|with)\b/i.test(sql);
  if (!startsWithReadOnly) {
    throw new Error("SQL must start with SELECT or WITH.");
  }
  if (FORBIDDEN_SQL_PATTERN.test(sql)) {
    throw new Error("SQL contains forbidden keywords.");
  }
}

function assertUserFilter(sql: string): void {
  if (!/\buser_id\s*=\s*\$1\b/i.test(sql)) {
    throw new Error("SQL must include an explicit user_id = $1 filter.");
  }
}

function assertBindParams(sql: string): void {
  const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number.parseInt(match[1] ?? "", 10));
  if (placeholders.some((value) => Number.isNaN(value) || value !== 1)) {
    throw new Error("Only bind variable $1 is allowed.");
  }
}

export function validateGeneratedSql(inputSql: string): string {
  const sql = stripTrailingSemicolon(inputSql);
  if (!sql) {
    throw new Error("SQL is empty.");
  }
  assertSingleStatement(sql);
  assertReadOnly(sql);
  assertUserFilter(sql);
  assertBindParams(sql);
  return sql;
}

export function wrapWithLimit100(validSql: string): string {
  return `SELECT * FROM (${validSql}) AS user_query LIMIT 100`;
}
