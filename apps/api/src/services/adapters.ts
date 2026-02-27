import { createHash, randomUUID } from "node:crypto";
import type { Institution, TransactionType } from "@writeoffs/shared";

export type RawRecord = Record<string, unknown>;

export type NormalizedTransaction = {
  id: string;
  userId: string;
  date: string;
  institution: Institution;
  description: string;
  amount: string;
  transactionType: TransactionType;
  rawData: RawRecord;
  dedupKey: string;
};

function dedup(userId: string, institution: Institution, date: string, description: string, amount: string, txType: TransactionType): string {
  return createHash("sha256").update([userId, institution, date, description, amount, txType].join("|")).digest("hex");
}

function buildRow(input: {
  userId: string;
  institution: Institution;
  date: string;
  description: string;
  amount: number;
  transactionType: TransactionType;
  rawData: RawRecord;
}): NormalizedTransaction {
  const normalizedAmount = Math.abs(input.amount).toFixed(2);
  return {
    id: randomUUID(),
    userId: input.userId,
    date: input.date,
    institution: input.institution,
    description: input.description.trim(),
    amount: normalizedAmount,
    transactionType: input.transactionType,
    rawData: input.rawData,
    dedupKey: dedup(input.userId, input.institution, input.date, input.description.trim(), normalizedAmount, input.transactionType),
  };
}

function parseNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const normalized = value.replaceAll("$", "").replaceAll(",", "").trim();
    const parsed = Number.parseFloat(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error(`Invalid amount: ${String(value)}`);
}

function parseDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10);
    }
  }

  if (typeof value !== "string") {
    throw new Error("Invalid date field");
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Invalid date field");
  }

  const mdy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const month = Number.parseInt(mdy[1], 10);
    const day = Number.parseInt(mdy[2], 10);
    const year = Number.parseInt(mdy[3], 10);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      return date.toISOString().slice(0, 10);
    }
    throw new Error(`Invalid date: ${value}`);
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return date.toISOString().slice(0, 10);
}

function normalizeRowsWithSkip(
  institution: Institution,
  rows: RawRecord[],
  transform: (row: RawRecord) => NormalizedTransaction | null,
): NormalizedTransaction[] {
  const normalized: NormalizedTransaction[] = [];
  let skippedByPolicy = 0;

  rows.forEach((row, index) => {
    try {
      const transformed = transform(row);
      if (transformed) {
        normalized.push(transformed);
      } else {
        skippedByPolicy += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const rawSnippet = JSON.stringify(row).slice(0, 300);
      console.warn(`[adapters:${institution}] Skipping row ${index + 1}: ${message}. raw=${rawSnippet}`);
    }
  });

  console.info(`[adapters:${institution}] rows=${rows.length} kept=${normalized.length} skippedByPolicy=${skippedByPolicy}`);
  return normalized;
}

export function normalizeChaseCsv(userId: string, rows: RawRecord[]): NormalizedTransaction[] {
  return normalizeRowsWithSkip("CHASE", rows, (row) => {
    const amount = parseNumber(row["Amount"]);
    const dateField = row["Transaction Date"] ?? row["Date"];
    const descriptionField = row["Description"] ?? row["Details"] ?? "";
    const transactionType: TransactionType = amount < 0 ? "DEBIT" : "CREDIT";
    if (transactionType === "CREDIT") {
      return null;
    }

    return buildRow({
      userId,
      institution: "CHASE",
      date: parseDate(dateField),
      description: String(descriptionField),
      amount,
      transactionType,
      rawData: row,
    });
  });
}

export function normalizeAmexCsv(userId: string, rows: RawRecord[]): NormalizedTransaction[] {
  return normalizeRowsWithSkip("AMEX", rows, (row) => {
    const amount = parseNumber(row["Amount"]);
    const transactionType: TransactionType = amount > 0 ? "DEBIT" : "CREDIT";
    if (transactionType === "CREDIT") {
      return null;
    }

    return buildRow({
      userId,
      institution: "AMEX",
      date: parseDate(row["Date"]),
      description: String(row["Description"] ?? ""),
      amount,
      transactionType,
      rawData: row,
    });
  });
}

export function normalizeCoinbasePdf(userId: string, rows: RawRecord[]): NormalizedTransaction[] {
  return normalizeRowsWithSkip("COINBASE", rows, (row) => {
    const amount = parseNumber(row["Amount"]);
    const transactionType: TransactionType = amount < 0 ? "CREDIT" : "DEBIT";
    if (transactionType === "CREDIT") {
      return null;
    }

    return buildRow({
      userId,
      institution: "COINBASE",
      date: parseDate(row["Date"]),
      description: String(row["Description"] ?? "Coinbase Purchase"),
      amount,
      transactionType,
      rawData: row,
    });
  });
}
