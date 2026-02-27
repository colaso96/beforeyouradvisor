import csv from "csv-parser";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { normalizeAmexCsv, normalizeChaseCsv, type NormalizedTransaction, type RawRecord } from "../adapters.js";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));

const CHASE_DEFAULT_FIXTURE = join(THIS_DIR, "chase.statement.csv");
const AMEX_DEFAULT_FIXTURE = join(THIS_DIR, "amex.statement.csv");
const COINBASE_DEFAULT_FIXTURE = join(THIS_DIR, "coinbase.statement.pdf");

export const CHASE_FIXTURE_PATH = process.env.CHASE_CSV_FIXTURE ?? CHASE_DEFAULT_FIXTURE;
export const AMEX_FIXTURE_PATH = process.env.AMEX_CSV_FIXTURE ?? AMEX_DEFAULT_FIXTURE;
export const COINBASE_FIXTURE_PATH = process.env.COINBASE_PDF_FIXTURE ?? COINBASE_DEFAULT_FIXTURE;

export function hasChaseFixture(): boolean {
  return existsSync(CHASE_FIXTURE_PATH);
}

export function hasAmexFixture(): boolean {
  return existsSync(AMEX_FIXTURE_PATH);
}

export function hasCoinbaseFixture(): boolean {
  return existsSync(COINBASE_FIXTURE_PATH);
}

export async function parseCsvBuffer(buffer: Buffer): Promise<RawRecord[]> {
  return new Promise((resolve, reject) => {
    const rows: RawRecord[] = [];
    Readable.from([buffer])
      .pipe(csv())
      .on("data", (row) => rows.push(row as RawRecord))
      .on("error", reject)
      .on("end", () => resolve(rows));
  });
}

export async function loadChaseFixture(userId: string): Promise<{ rawRows: RawRecord[]; normalizedRows: NormalizedTransaction[] }> {
  const csvBuffer = await readFile(CHASE_FIXTURE_PATH);
  const rawRows = await parseCsvBuffer(csvBuffer);
  const normalizedRows = normalizeChaseCsv(userId, rawRows);
  return { rawRows, normalizedRows };
}

export async function loadAmexFixture(userId: string): Promise<{ rawRows: RawRecord[]; normalizedRows: NormalizedTransaction[] }> {
  const csvBuffer = await readFile(AMEX_FIXTURE_PATH);
  const rawRows = await parseCsvBuffer(csvBuffer);
  const normalizedRows = normalizeAmexCsv(userId, rawRows);
  return { rawRows, normalizedRows };
}

