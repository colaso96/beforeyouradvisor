import { randomUUID } from "node:crypto";
import { GoogleGenAI, Type } from "@google/genai";
import { transactionChatTableSchema, type TransactionChatMessage, type TransactionChatTable } from "@writeoffs/shared";
import { env } from "../config/env.js";
import { query } from "../db/client.js";
import { validateGeneratedSql, wrapWithLimit100 } from "./transactionSqlGuard.js";

const CONTEXT_MESSAGE_LIMIT = 5;
const SQL_RETRY_LIMIT = 3;

type DbChatMessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sql: string | null;
  resultJson: unknown;
  createdAt: string;
};

type SqlGenerationResponse = {
  sql: string;
};

type SummaryResponse = {
  answer: string;
};

function userRequestedRowLevelDetails(message: string): boolean {
  return /(show|include|list|return).*(id|date|institution|amount|description|row|record|transaction)/i.test(message);
}

function parseTablePayload(input: unknown): TransactionChatTable | null {
  if (input == null) return null;
  const parsed = transactionChatTableSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

function toChatMessage(row: DbChatMessageRow): TransactionChatMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    sql: row.sql,
    resultTable: parseTablePayload(row.resultJson),
    createdAt: row.createdAt,
  };
}

function toSerializableValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toSerializableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toSerializableValue(v)]));
  }
  return value;
}

function toResultTable(rows: Record<string, unknown>[]): TransactionChatTable {
  const columns = rows[0] ? Object.keys(rows[0]) : [];
  return {
    columns,
    rows: rows.map((row) => Object.fromEntries(columns.map((column) => [column, toSerializableValue(row[column])]))),
  };
}

async function insertChatMessage(input: {
  userId: string;
  role: "user" | "assistant";
  content: string;
  sql?: string | null;
  resultTable?: TransactionChatTable | null;
}): Promise<TransactionChatMessage> {
  const id = randomUUID();
  const result = await query<DbChatMessageRow>(
    `INSERT INTO transaction_chat_messages (id, user_id, role, content, sql_text, result_json)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING id,
               role,
               content,
               sql_text AS sql,
               result_json AS "resultJson",
               created_at::text AS "createdAt"`,
    [id, input.userId, input.role, input.content, input.sql ?? null, input.resultTable == null ? null : JSON.stringify(input.resultTable)],
  );
  return toChatMessage(result.rows[0]!);
}

async function loadContextMessages(userId: string): Promise<TransactionChatMessage[]> {
  const result = await query<DbChatMessageRow>(
    `SELECT id,
            role,
            content,
            sql_text AS sql,
            result_json AS "resultJson",
            created_at::text AS "createdAt"
     FROM transaction_chat_messages
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, CONTEXT_MESSAGE_LIMIT],
  );

  return result.rows.reverse().map(toChatMessage);
}

async function generateSqlQuery(input: {
  contextMessages: TransactionChatMessage[];
  userMessage: string;
  previousSql?: string;
  previousError?: string;
}): Promise<SqlGenerationResponse> {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const retrySection =
    input.previousError && input.previousSql
      ? [
          "",
          "Previous SQL failed. Correct it and return a fixed SQL query.",
          `Previous SQL: ${input.previousSql}`,
          `Postgres error: ${input.previousError}`,
        ]
      : [];
  const allowRowLevelDetails = userRequestedRowLevelDetails(input.userMessage);

  const prompt = [
    "You are a Postgres SQL agent for transaction analytics.",
    "You must return JSON with key: sql.",
    "",
    "Rules:",
    "- Generate a single read-only SQL statement (SELECT or WITH...SELECT).",
    "- Query only transaction data.",
    "- SQL MUST include `user_id = $1`.",
    "- SQL must be valid for PostgreSQL.",
    "- Do not include markdown fences.",
    "- Return only SQL. Do not answer the user question yet.",
    "",
    "transactions table schema:",
    "- id UUID",
    "- user_id UUID",
    "- date DATE",
    "- institution TEXT ('CHASE'|'AMEX'|'COINBASE')",
    "- description TEXT",
    "- amount NUMERIC(12,2)",
    "- transaction_type TEXT ('DEBIT'|'CREDIT')",
    "- llm_category TEXT NULL",
    "- is_deductible BOOLEAN NULL",
    "- llm_reasoning TEXT NULL",
    "- raw_data JSONB",
    "- dedup_key TEXT",
    "- created_at TIMESTAMPTZ",
    "- updated_at TIMESTAMPTZ",
    "",
    "Recent conversation context (oldest to newest):",
    JSON.stringify(input.contextMessages.map((msg) => ({ role: msg.role, content: msg.content }))),
    "",
    `User request: ${input.userMessage}`,
    ...retrySection,
  ].join("\n");

  const response = await client.models.generateContent({
    model: env.GEMINI_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        additionalProperties: false,
        properties: {
          sql: { type: Type.STRING },
        },
        required: ["sql"],
      },
    },
  });

  const payload = response.text;
  if (!payload) {
    throw new Error("Model response was empty.");
  }

  const parsed = JSON.parse(payload) as Partial<SqlGenerationResponse>;
  if (!parsed.sql) {
    throw new Error("Model response did not include required SQL.");
  }
  return { sql: parsed.sql };
}

async function summarizeQueryResults(input: {
  contextMessages: TransactionChatMessage[];
  userMessage: string;
  validatedSql: string;
  resultTable: TransactionChatTable;
}): Promise<SummaryResponse> {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const allowRowLevelDetails = userRequestedRowLevelDetails(input.userMessage);
  const prompt = [
    "You are a transaction analytics assistant.",
    "You must return JSON with key: answer.",
    "",
    "Task:",
    "- Summarize query results for the user's question using only the provided SQL result rows.",
    "- If no rows are returned, say that clearly and suggest a helpful follow-up query idea.",
    "",
    "Rules:",
    "- Keep answer concise and factual.",
    "- Do not claim values not present in the result rows.",
    "- Default to natural-language insight summaries (trends, totals, outliers), not row-by-row log formatting.",
    allowRowLevelDetails
      ? "- The user explicitly asked for row-level fields; including specific row details is allowed."
      : "- Do not output templated row logs with id/date/institution/amount/description unless explicitly requested.",
    "",
    "Recent conversation context (oldest to newest):",
    JSON.stringify(input.contextMessages.map((msg) => ({ role: msg.role, content: msg.content }))),
    "",
    `User request: ${input.userMessage}`,
    `Executed SQL: ${input.validatedSql}`,
    "Result rows JSON (already limited):",
    JSON.stringify(input.resultTable),
  ].join("\n");

  const response = await client.models.generateContent({
    model: env.GEMINI_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        additionalProperties: false,
        properties: {
          answer: { type: Type.STRING },
        },
        required: ["answer"],
      },
    },
  });

  const payload = response.text;
  if (!payload) {
    throw new Error("Model response was empty.");
  }

  const parsed = JSON.parse(payload) as Partial<SummaryResponse>;
  if (!parsed.answer) {
    throw new Error("Model response did not include required fields.");
  }
  return { answer: parsed.answer };
}

export async function getTransactionChatEligibility(userId: string): Promise<{ eligible: boolean; transactionCount: number; minRequired: number }> {
  const countResult = await query<{ count: string }>("SELECT COUNT(*)::text AS count FROM transactions WHERE user_id = $1", [userId]);
  const transactionCount = Number.parseInt(countResult.rows[0]?.count ?? "0", 10);
  const minRequired = 2;
  return { eligible: transactionCount >= minRequired, transactionCount, minRequired };
}

export async function clearTransactionChatHistory(userId: string): Promise<void> {
  await query("DELETE FROM transaction_chat_messages WHERE user_id = $1", [userId]);
}

export async function sendTransactionChatMessage(input: { userId: string; message: string }): Promise<TransactionChatMessage> {
  const eligibility = await getTransactionChatEligibility(input.userId);
  if (!eligibility.eligible) {
    throw new Error(`At least ${eligibility.minRequired} transaction rows are required before using chat.`);
  }

  await insertChatMessage({
    userId: input.userId,
    role: "user",
    content: input.message,
  });

  const contextMessages = await loadContextMessages(input.userId);
  let previousSql: string | undefined;
  let previousError: string | undefined;

  for (let attempt = 0; attempt <= SQL_RETRY_LIMIT; attempt += 1) {
    try {
      const sqlResponse = await generateSqlQuery({
        contextMessages,
        userMessage: input.message,
        previousSql,
        previousError,
      });
      previousSql = sqlResponse.sql;
      const validatedSql = validateGeneratedSql(sqlResponse.sql);
      const executableSql = wrapWithLimit100(validatedSql);
      const data = await query<Record<string, unknown>>(executableSql, [input.userId]);
      const resultTable = toResultTable(data.rows);
      let assistantContent = "results here:";
      try {
        const summary = await summarizeQueryResults({
          contextMessages,
          userMessage: input.message,
          validatedSql,
          resultTable,
        });
        assistantContent = summary.answer;
      } catch {
        assistantContent = "results here:";
      }

      return insertChatMessage({
        userId: input.userId,
        role: "assistant",
        content: assistantContent,
        sql: validatedSql,
        resultTable,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown SQL agent error";
      if (attempt < SQL_RETRY_LIMIT) {
        previousError = message;
        continue;
      }

      return insertChatMessage({
        userId: input.userId,
        role: "assistant",
        content: `I couldn't complete that query after ${SQL_RETRY_LIMIT + 1} attempts. ${message}`,
        sql: previousSql ?? null,
        resultTable: null,
      });
    }
  }

  return insertChatMessage({
    userId: input.userId,
    role: "assistant",
    content: "I couldn't complete that query.",
    sql: null,
    resultTable: null,
  });
}
