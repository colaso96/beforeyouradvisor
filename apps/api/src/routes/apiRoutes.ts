import { randomUUID } from "node:crypto";
import { Router } from "express";
import { analysisStartSchema, ingestionStartSchema, profileSchema } from "@writeoffs/shared";
import { query } from "../db/client.js";
import { requireAuth } from "./middleware.js";
import { extractDriveFolderId } from "../utils/folderId.js";
import { enqueueAnalysis, enqueueIngestion } from "../jobs/queue.js";
import { isCanonicalBusinessProfileKey, listBusinessProfileOptions } from "../services/businessProfileService.js";
import { normalizeCategory } from "../utils/category.js";

export const apiRouter = Router();

apiRouter.use(requireAuth);

function csvEscape(value: unknown): string {
  const stringValue = value == null ? "" : String(value);
  const escaped = stringValue.replace(/"/g, "\"\"");
  return `"${escaped}"`;
}

apiRouter.get("/business-profiles", async (_req, res) => {
  res.json({ rows: listBusinessProfileOptions() });
});

apiRouter.get("/me", async (req, res) => {
  const userId = req.user!.id;
  const result = await query(
    `SELECT id, email, business_type AS "businessType", aggressiveness_level AS "aggressivenessLevel"
     FROM users WHERE id = $1`,
    [userId],
  );

  if (!result.rowCount) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(result.rows[0]);
});

apiRouter.put("/users/profile", async (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const userId = req.user!.id;
  const { businessType, aggressivenessLevel } = parsed.data;
  if (!isCanonicalBusinessProfileKey(businessType)) {
    res.status(400).json({ error: "businessType must be a canonical business profile key." });
    return;
  }

  await query(
    `UPDATE users
     SET business_type = $1, aggressiveness_level = $2, updated_at = NOW()
     WHERE id = $3`,
    [businessType, aggressivenessLevel, userId],
  );

  res.status(204).send();
});

apiRouter.post("/ingestion/start", async (req, res) => {
  const parsed = ingestionStartSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const accessToken = req.user?.accessToken;
  if (!accessToken) {
    res.status(400).json({ error: "Google access token is missing; re-authenticate." });
    return;
  }

  let folderId: string;
  try {
    folderId = extractDriveFolderId(parsed.data.driveFolderUrl);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
    return;
  }
  const jobId = randomUUID();
  const userId = req.user!.id;
  console.info(`[ingestion:${jobId}] start requested by user=${userId}`);
  const existingTx = await query<{ count: string }>("SELECT COUNT(*)::text AS count FROM transactions WHERE user_id = $1", [userId]);
  const deletedTransactions = Number(existingTx.rows[0]?.count ?? "0");

  if (deletedTransactions > 0) {
    await query("DELETE FROM transactions WHERE user_id = $1", [userId]);
    console.info(`[ingestion:${jobId}] cleared existing transactions user=${userId} deleted=${deletedTransactions}`);
  }

  await query(
    `INSERT INTO ingestion_jobs (id, user_id, status, drive_folder_id)
     VALUES ($1, $2, 'queued', $3)`,
    [jobId, userId, folderId],
  );

  enqueueIngestion({ jobId, userId, accessToken, folderId });
  res.status(202).json({ jobId, state: "queued", refreshed: deletedTransactions > 0, deletedTransactions });
});

apiRouter.get("/ingestion/status/:jobId", async (req, res) => {
  const result = await query(
    `SELECT id AS "jobId", status AS state, processed_files AS processed, total_files AS total, error
     FROM ingestion_jobs WHERE id = $1 AND user_id = $2`,
    [req.params.jobId, req.user!.id],
  );

  if (!result.rowCount) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.json(result.rows[0]);
});

apiRouter.post("/analysis/start", async (req, res) => {
  const parsed = analysisStartSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const requestedIngestionJobId = parsed.data.ingestionJobId;
  const analysisNote = parsed.data.analysisNote?.trim() || undefined;
  const ingestion = requestedIngestionJobId
    ? await query<{ id: string; status: string }>(
        "SELECT id, status FROM ingestion_jobs WHERE id = $1 AND user_id = $2",
        [requestedIngestionJobId, req.user!.id],
      )
    : await query<{ id: string; status: string }>(
        `SELECT id, status
         FROM ingestion_jobs
         WHERE user_id = $1
           AND status = 'completed'
         ORDER BY updated_at DESC, created_at DESC
         LIMIT 1`,
        [req.user!.id],
      );

  if (!ingestion.rowCount || ingestion.rows[0]?.status !== "completed") {
    res.status(400).json({ error: "A completed ingestion run is required before analysis." });
    return;
  }

  const userConfig = await query<{ businessType: string | null; aggressivenessLevel: string | null }>(
    `SELECT business_type AS "businessType", aggressiveness_level AS "aggressivenessLevel"
     FROM users
     WHERE id = $1`,
    [req.user!.id],
  );
  const config = userConfig.rows[0];
  if (!config?.businessType || !config.aggressivenessLevel || !isCanonicalBusinessProfileKey(config.businessType)) {
    res.status(400).json({ error: "Profile must be saved with a valid business role before analysis." });
    return;
  }

  const cleared = await query(
    `UPDATE transactions
     SET llm_category = NULL, is_deductible = NULL, llm_reasoning = NULL, updated_at = NOW()
     WHERE user_id = $1
       AND (llm_category IS NOT NULL OR is_deductible IS NOT NULL OR llm_reasoning IS NOT NULL)`,
    [req.user!.id],
  );
  const clearedClassifications = cleared.rowCount ?? 0;

  const jobId = randomUUID();
  console.info(`[analysis:${jobId}] start requested by user=${req.user!.id}`);
  await query(
    `INSERT INTO analysis_jobs (id, user_id, status)
     VALUES ($1, $2, 'queued')`,
    [jobId, req.user!.id],
  );

  enqueueAnalysis({ jobId, userId: req.user!.id, analysisNote });
  if (clearedClassifications > 0) {
    console.info(`[analysis:${jobId}] cleared previous classifications user=${req.user!.id} count=${clearedClassifications}`);
  }
  res.status(202).json({ jobId, state: "queued", refreshed: clearedClassifications > 0, clearedClassifications });
});

apiRouter.get("/analysis/status/:jobId", async (req, res) => {
  const result = await query(
    `SELECT id AS "jobId", status AS state, processed, total, error
     FROM analysis_jobs WHERE id = $1 AND user_id = $2`,
    [req.params.jobId, req.user!.id],
  );

  if (!result.rowCount) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.json(result.rows[0]);
});

apiRouter.get("/transactions/summary", async (req, res) => {
  const result = await query<{
    category: string | null;
    amount: string;
    isDeductible: boolean | null;
  }>(
    `SELECT llm_category AS category, amount::text AS amount, is_deductible AS "isDeductible"
     FROM transactions
     WHERE user_id = $1
       AND transaction_type = 'DEBIT'
       AND llm_category IS NOT NULL`,
    [req.user!.id],
  );

  const summary = new Map<
    string,
    {
      category: string;
      deductibleAmount: number;
      nonDeductibleAmount: number;
      deductibleCount: number;
      nonDeductibleCount: number;
      totalAmount: number;
      totalCount: number;
    }
  >();

  for (const row of result.rows) {
    const category = normalizeCategory(row.category);
    const amount = Number.parseFloat(row.amount);
    const existing = summary.get(category) ?? {
      category,
      deductibleAmount: 0,
      nonDeductibleAmount: 0,
      deductibleCount: 0,
      nonDeductibleCount: 0,
      totalAmount: 0,
      totalCount: 0,
    };

    existing.totalAmount += amount;
    existing.totalCount += 1;
    if (row.isDeductible === true) {
      existing.deductibleAmount += amount;
      existing.deductibleCount += 1;
    } else if (row.isDeductible === false) {
      existing.nonDeductibleAmount += amount;
      existing.nonDeductibleCount += 1;
    }

    summary.set(category, existing);
  }

  const rows = [...summary.values()]
    .sort((a, b) => b.totalAmount - a.totalAmount || a.category.localeCompare(b.category))
    .map((row) => ({
      category: row.category,
      deductibleAmount: row.deductibleAmount.toFixed(2),
      nonDeductibleAmount: row.nonDeductibleAmount.toFixed(2),
      deductibleCount: row.deductibleCount,
      nonDeductibleCount: row.nonDeductibleCount,
      totalAmount: row.totalAmount.toFixed(2),
      totalCount: row.totalCount,
    }));

  res.json({ rows });
});

apiRouter.get("/transactions/export.csv", async (req, res) => {
  const rows = await query<{
    id: string;
    date: string;
    institution: string;
    description: string;
    amount: string;
    transactionType: string;
    llmCategory: string | null;
    isDeductible: boolean | null;
    llmReasoning: string | null;
  }>(
    `SELECT id,
            date::text AS date,
            institution,
            description,
            amount::text AS amount,
            transaction_type AS "transactionType",
            llm_category AS "llmCategory",
            is_deductible AS "isDeductible",
            llm_reasoning AS "llmReasoning"
     FROM transactions
     WHERE user_id = $1
       AND transaction_type = 'DEBIT'
     ORDER BY date DESC, id DESC`,
    [req.user!.id],
  );

  const header = [
    "transaction_id",
    "date",
    "institution",
    "description",
    "amount",
    "transaction_type",
    "category",
    "is_deductible",
    "llm_reasoning",
  ];

  const lines = [
    header.join(","),
    ...rows.rows.map((row) =>
      [
        csvEscape(row.id),
        csvEscape(row.date),
        csvEscape(row.institution),
        csvEscape(row.description),
        csvEscape(row.amount),
        csvEscape(row.transactionType),
        csvEscape(normalizeCategory(row.llmCategory)),
        csvEscape(row.isDeductible == null ? "" : row.isDeductible ? "true" : "false"),
        csvEscape(row.llmReasoning ?? ""),
      ].join(","),
    ),
  ];

  const dateStamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="transactions-${dateStamp}.csv"`);
  res.status(200).send(lines.join("\n"));
});

apiRouter.get("/transactions", async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 500);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);
  const status = String(req.query.status ?? "all");
  const samplePerInstitution = Math.max(Number(req.query.samplePerInstitution ?? 0), 0);

  const where = status === "unclassified" ? "AND llm_category IS NULL" : status === "classified" ? "AND llm_category IS NOT NULL" : "";
  const debitOnly = "AND transaction_type = 'DEBIT'";
  const suppressKnownCoinbaseNoise = `
    AND NOT (
      institution = 'COINBASE'
      AND (
        description ILIKE '%Total new charges in this period%'
        OR description ILIKE '%Important disclosures%'
        OR description ILIKE '%Billing Rights Summary%'
      )
    )
  `;

  const result =
    samplePerInstitution > 0
      ? await query(
          `WITH base AS (
             SELECT
               id,
               date,
               institution,
               description,
               amount,
               transaction_type,
               llm_category,
               is_deductible,
               llm_reasoning
             FROM transactions
             WHERE user_id = $1 ${debitOnly} ${where} ${suppressKnownCoinbaseNoise}
           ),
           ranked AS (
             SELECT
               id,
               date::text AS date,
               institution,
               description,
               amount::text AS amount,
               transaction_type AS "transactionType",
               llm_category AS "llmCategory",
               is_deductible AS "isDeductible",
               llm_reasoning AS "llmReasoning",
               ROW_NUMBER() OVER (PARTITION BY institution ORDER BY date DESC, id DESC) AS rn
             FROM base
           ),
           sampled AS (
             SELECT id, date, institution, description, amount, "transactionType", "llmCategory", "isDeductible", "llmReasoning"
             FROM ranked
             WHERE rn <= $2
           ),
           extras AS (
             SELECT
               b.id,
               b.date::text AS date,
               b.institution,
               b.description,
               b.amount::text AS amount,
               b.transaction_type AS "transactionType",
               b.llm_category AS "llmCategory",
               b.is_deductible AS "isDeductible",
               b.llm_reasoning AS "llmReasoning"
             FROM base b
             LEFT JOIN sampled s ON s.id = b.id
             WHERE s.id IS NULL
             ORDER BY b.date DESC, b.id DESC
             LIMIT GREATEST($3 - (SELECT COUNT(*) FROM sampled), 0)
           ),
           combined AS (
             SELECT * FROM sampled
             UNION ALL
             SELECT * FROM extras
           )
           SELECT id, date, institution, description, amount, "transactionType", "llmCategory", "isDeductible", "llmReasoning"
           FROM combined
           ORDER BY date DESC, id DESC
           LIMIT $3`,
          [req.user!.id, samplePerInstitution, limit],
        )
      : await query(
          `SELECT id, date::text AS date, institution, description, amount::text, transaction_type AS "transactionType", llm_category AS "llmCategory", is_deductible AS "isDeductible", llm_reasoning AS "llmReasoning"
           FROM transactions
           WHERE user_id = $1 ${debitOnly} ${where} ${suppressKnownCoinbaseNoise}
           ORDER BY date DESC, id DESC
           LIMIT $2 OFFSET $3`,
          [req.user!.id, limit, offset],
        );

  const normalizedRows = result.rows.map((row) => ({
    ...row,
    llmCategory: row.llmCategory == null ? null : normalizeCategory(row.llmCategory),
  }));
  res.json({ rows: normalizedRows });
});
