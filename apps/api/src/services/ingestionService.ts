import csv from "csv-parser";
import { Readable } from "node:stream";
import { query } from "../db/client.js";
import { downloadFile, listSupportedFiles, type DriveFile } from "./driveService.js";
import { extractCoinbaseRowsFromPdf } from "./coinbasePdfService.js";
import { normalizeAmexCsv, normalizeChaseCsv, normalizeCoinbasePdf, type NormalizedTransaction, type RawRecord } from "./adapters.js";
import { errorToLogString } from "../utils/errorLog.js";

async function parseCsv(buffer: Buffer): Promise<RawRecord[]> {
  return new Promise((resolve, reject) => {
    const rows: RawRecord[] = [];
    Readable.from([buffer])
      .pipe(csv())
      .on("data", (row) => rows.push(row as RawRecord))
      .on("error", reject)
      .on("end", () => resolve(rows));
  });
}

function detectCsvAdapter(rows: RawRecord[], fileName: string): "CHASE" | "AMEX" {
  const firstRow = rows[0] ?? {};
  const headerSet = new Set(
    Object.keys(firstRow).map((key) => key.replace(/^\uFEFF/, "").trim().toLowerCase()),
  );

  if (headerSet.has("transaction date") || headerSet.has("post date") || headerSet.has("type") || headerSet.has("category")) {
    return "CHASE";
  }

  if (headerSet.has("date") && headerSet.has("description") && headerSet.has("amount") && !headerSet.has("transaction date")) {
    return "AMEX";
  }

  const name = fileName.toLowerCase();
  if (name.includes("amex") || name.includes("american express")) return "AMEX";
  if (name.includes("chase")) return "CHASE";

  let positives = 0;
  let negatives = 0;
  for (const row of rows.slice(0, 50)) {
    const value = row["Amount"];
    if (typeof value !== "string" && typeof value !== "number") continue;
    const parsed = Number.parseFloat(String(value).replaceAll("$", "").replaceAll(",", "").trim());
    if (!Number.isFinite(parsed)) continue;
    if (parsed > 0) positives += 1;
    if (parsed < 0) negatives += 1;
  }

  if (positives > negatives) return "AMEX";
  return "CHASE";
}

export function pickAdapter(file: DriveFile, rows?: RawRecord[]): "CHASE" | "AMEX" | "COINBASE" {
  if (file.mimeType === "application/pdf") return "COINBASE";
  if (rows) return detectCsvAdapter(rows, file.name);
  const name = file.name.toLowerCase();
  if (name.includes("amex") || name.includes("american express")) return "AMEX";
  return "CHASE";
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function persistTransactions(rows: NormalizedTransaction[]): Promise<void> {
  if (!rows.length) return;
  const values: string[] = [];
  const args: unknown[] = [];

  rows.forEach((row, idx) => {
    const base = idx * 9;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}::jsonb, $${base + 9}, NOW())`);
    args.push(row.id, row.userId, row.date, row.institution, row.description, row.amount, row.transactionType, JSON.stringify(row.rawData), row.dedupKey);
  });

  await query(
    `INSERT INTO transactions (id, user_id, date, institution, description, amount, transaction_type, raw_data, dedup_key, updated_at)
     VALUES ${values.join(",")}
     ON CONFLICT (dedup_key) DO NOTHING`,
    args,
  );
}

export async function runIngestionJob(jobId: string, userId: string, accessToken: string, folderId: string): Promise<void> {
  console.info(`[ingestion:${jobId}] Starting ingestion for user=${userId} folder=${folderId}`);
  await query("UPDATE ingestion_jobs SET status = 'running', drive_folder_id = $1, updated_at = NOW() WHERE id = $2", [folderId, jobId]);

  try {
    const files = await listSupportedFiles(accessToken, folderId);
    console.info(`[ingestion:${jobId}] Found ${files.length} supported files`);
    await query("UPDATE ingestion_jobs SET total_files = $1, updated_at = NOW() WHERE id = $2", [files.length, jobId]);

    let processed = 0;
    for (const file of files) {
      const fileLabel = `${file.name} (${file.id})`;
      console.info(`[ingestion:${jobId}] Processing file ${processed + 1}/${files.length}: ${fileLabel}`);

      try {
        const raw = await downloadFile(accessToken, file.id);
        let normalized: NormalizedTransaction[] = [];
        const mimeAdapter = pickAdapter(file);
        if (mimeAdapter === "COINBASE") {
          const rows = await extractCoinbaseRowsFromPdf(raw);
          normalized = normalizeCoinbasePdf(userId, rows);
          console.info(`[ingestion:${jobId}] Adapter selected: COINBASE for ${fileLabel}`);
        } else {
          const rows = await parseCsv(raw);
          const csvAdapter = pickAdapter(file, rows);
          console.info(`[ingestion:${jobId}] Adapter selected: ${csvAdapter} for ${fileLabel}`);
          normalized = csvAdapter === "AMEX" ? normalizeAmexCsv(userId, rows) : normalizeChaseCsv(userId, rows);
        }

        console.info(`[ingestion:${jobId}] Parsed ${normalized.length} transactions from ${fileLabel}`);
        await persistTransactions(normalized);
        processed += 1;
        await query("UPDATE ingestion_jobs SET processed_files = $1, updated_at = NOW() WHERE id = $2", [processed, jobId]);
      } catch (error) {
        const fileError = `Failed file ${fileLabel}: ${getErrorMessage(error)}`;
        console.error(`[ingestion:${jobId}] ${fileError} | details: ${errorToLogString(error)}`);
        throw new Error(fileError);
      }
    }

    console.info(`[ingestion:${jobId}] Completed ingestion`);
    await query("UPDATE ingestion_jobs SET status = 'completed', updated_at = NOW() WHERE id = $1", [jobId]);
  } catch (error) {
    const message = getErrorMessage(error);
    console.error(`[ingestion:${jobId}] Job failed: ${message} | details: ${errorToLogString(error)}`);
    await query("UPDATE ingestion_jobs SET status = 'failed', error = $1, updated_at = NOW() WHERE id = $2", [
      message,
      jobId,
    ]);
  }
}
