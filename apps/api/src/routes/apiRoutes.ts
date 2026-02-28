import { randomUUID } from "node:crypto";
import { type Request, type Response, Router } from "express";
import {
  analysisCheckoutFinalizeSchema,
  analysisCheckoutStartSchema,
  analysisStartSchema,
  ingestionStartSchema,
  profileSchema,
  transactionChatSendSchema,
} from "@writeoffs/shared";
import { query } from "../db/client.js";
import { requireAuth } from "./middleware.js";
import { extractDriveFolderId } from "../utils/folderId.js";
import { enqueueAnalysis, enqueueIngestion } from "../jobs/queue.js";
import { isCanonicalBusinessProfileKey, listBusinessProfileOptions } from "../services/businessProfileService.js";
import { normalizeCategory } from "../utils/category.js";
import { env } from "../config/env.js";
import {
  clearTransactionChatHistory,
  getTransactionChatEligibility,
  sendTransactionChatMessage,
} from "../services/transactionChatService.js";

export const apiRouter = Router();

apiRouter.use(requireAuth);

function csvEscape(value: unknown): string {
  const stringValue = value == null ? "" : String(value);
  const escaped = stringValue.replace(/"/g, "\"\"");
  return `"${escaped}"`;
}

type AnalysisStartInput = {
  ingestionJobId?: string;
  analysisNote?: string;
};

type AnalysisStartOutcome = {
  jobId: string;
  state: "queued";
  refreshed: boolean;
  clearedClassifications: number;
};

type IngestionLookupRow = {
  id: string;
  status: string;
};

type UserConfigRow = {
  businessType: string | null;
  aggressivenessLevel: string | null;
};

type AnalysisPaymentRow = {
  id: string;
  userId: string;
  stripeSessionId: string;
  status: "created" | "paid" | "consumed" | "expired" | "failed";
  ingestionJobId: string | null;
  analysisNote: string | null;
  analysisJobId: string | null;
};

type AnalysisJobStatusRow = {
  jobId: string;
  state: "queued" | "running" | "completed" | "failed";
  processed: number;
  total: number;
  error: string | null;
};

const defaultSuccessUrl = `${env.APP_ORIGIN}/?checkout_session_id={CHECKOUT_SESSION_ID}`;
const defaultCancelUrl = `${env.APP_ORIGIN}/?checkout_cancelled=1`;
const ANALYSIS_CHECKOUT_PRICE_CENTS = 1000;
const ANALYSIS_CHECKOUT_PRODUCT_NAME = "AI Analysis";

type StripeCheckoutSession = {
  id: string;
  url: string | null;
  mode: string | null;
  payment_status: string | null;
  metadata: Record<string, string> | null;
};

function ensureStripeConfiguration(): void {
  if (env.STRIPE_SECRET_KEY === "sk_test_placeholder") {
    throw new Error("STRIPE_SECRET_KEY is not configured. Update your .env file.");
  }
}

async function stripeCreateCheckoutSession(input: {
  successUrl: string;
  cancelUrl: string;
  userId: string;
  ingestionJobId: string;
  analysisNote?: string;
}): Promise<StripeCheckoutSession> {
  ensureStripeConfiguration();
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("line_items[0][price_data][currency]", "usd");
  form.set("line_items[0][price_data][unit_amount]", String(ANALYSIS_CHECKOUT_PRICE_CENTS));
  form.set("line_items[0][price_data][product_data][name]", ANALYSIS_CHECKOUT_PRODUCT_NAME);
  form.set("line_items[0][quantity]", "1");
  form.set("success_url", input.successUrl);
  form.set("cancel_url", input.cancelUrl);
  form.set("metadata[userId]", input.userId);
  form.set("metadata[ingestionJobId]", input.ingestionJobId);
  if (input.analysisNote) {
    form.set("metadata[analysisNote]", input.analysisNote);
  }

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Stripe checkout session create failed (${response.status}): ${body.slice(0, 300)}`);
  }

  return (await response.json()) as StripeCheckoutSession;
}

async function stripeRetrieveCheckoutSession(checkoutSessionId: string): Promise<StripeCheckoutSession> {
  ensureStripeConfiguration();
  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(checkoutSessionId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Stripe checkout session retrieve failed (${response.status}): ${body.slice(0, 300)}`);
  }

  return (await response.json()) as StripeCheckoutSession;
}

async function findAnalysisPaymentSession(userId: string, checkoutSessionId: string): Promise<AnalysisPaymentRow | null> {
  const existing = await query<AnalysisPaymentRow>(
    `SELECT id,
            user_id AS "userId",
            stripe_session_id AS "stripeSessionId",
            status,
            ingestion_job_id AS "ingestionJobId",
            analysis_note AS "analysisNote",
            analysis_job_id AS "analysisJobId"
     FROM analysis_payment_sessions
     WHERE stripe_session_id = $1
       AND user_id = $2`,
    [checkoutSessionId, userId],
  );
  return existing.rows[0] ?? null;
}

async function findAnalysisJobStatus(userId: string, jobId: string): Promise<AnalysisJobStatusRow | null> {
  const status = await query<AnalysisJobStatusRow>(
    `SELECT id AS "jobId", status AS state, processed, total, error
     FROM analysis_jobs
     WHERE id = $1
       AND user_id = $2`,
    [jobId, userId],
  );
  return status.rows[0] ?? null;
}

async function startAnalysisCheckoutForUser(
  userId: string,
  input: { ingestionJobId?: string; analysisNote?: string },
): Promise<{ checkoutUrl: string; checkoutSessionId: string }> {
  const preflight = await requireAnalysisPrerequisites(userId, input);

  const checkout = await stripeCreateCheckoutSession({
    successUrl: env.STRIPE_SUCCESS_URL ?? defaultSuccessUrl,
    cancelUrl: env.STRIPE_CANCEL_URL ?? defaultCancelUrl,
    userId,
    ingestionJobId: preflight.ingestionJobId,
    analysisNote: preflight.analysisNote,
  });

  const paymentId = randomUUID();
  await query(
    `INSERT INTO analysis_payment_sessions (id, user_id, stripe_session_id, status, ingestion_job_id, analysis_note)
     VALUES ($1, $2, $3, 'created', $4, $5)`,
    [paymentId, userId, checkout.id, preflight.ingestionJobId, preflight.analysisNote ?? null],
  );

  if (!checkout.url) {
    throw new Error("Stripe did not return a checkout URL.");
  }

  return { checkoutUrl: checkout.url, checkoutSessionId: checkout.id };
}

async function requireAnalysisPrerequisites(userId: string, input: AnalysisStartInput): Promise<{ ingestionJobId: string; analysisNote?: string }> {
  const requestedIngestionJobId = input.ingestionJobId;
  const analysisNote = input.analysisNote?.trim() || undefined;
  const ingestion = requestedIngestionJobId
    ? await query<IngestionLookupRow>("SELECT id, status FROM ingestion_jobs WHERE id = $1 AND user_id = $2", [requestedIngestionJobId, userId])
    : await query<IngestionLookupRow>(
        `SELECT id, status
         FROM ingestion_jobs
         WHERE user_id = $1
           AND status = 'completed'
         ORDER BY updated_at DESC, created_at DESC
         LIMIT 1`,
        [userId],
      );

  if (!ingestion.rowCount || ingestion.rows[0]?.status !== "completed") {
    throw new Error("A completed ingestion run is required before analysis.");
  }

  const userConfig = await query<UserConfigRow>(
    `SELECT business_type AS "businessType", aggressiveness_level AS "aggressivenessLevel"
     FROM users
     WHERE id = $1`,
    [userId],
  );
  const config = userConfig.rows[0];
  if (!config?.businessType || !config.aggressivenessLevel || !isCanonicalBusinessProfileKey(config.businessType)) {
    throw new Error("Profile must be saved with a valid business role before analysis.");
  }

  return {
    ingestionJobId: ingestion.rows[0]!.id,
    analysisNote,
  };
}

async function enqueueAnalysisStart(userId: string, input: AnalysisStartInput): Promise<AnalysisStartOutcome> {
  const preflight = await requireAnalysisPrerequisites(userId, input);
  const cleared = await query(
    `UPDATE transactions
     SET llm_category = NULL, is_deductible = NULL, llm_reasoning = NULL, updated_at = NOW()
     WHERE user_id = $1
       AND (llm_category IS NOT NULL OR is_deductible IS NOT NULL OR llm_reasoning IS NOT NULL)`,
    [userId],
  );
  const clearedClassifications = cleared.rowCount ?? 0;

  const jobId = randomUUID();
  console.info(`[analysis:${jobId}] start requested by user=${userId}`);
  await query(
    `INSERT INTO analysis_jobs (id, user_id, status)
     VALUES ($1, $2, 'queued')`,
    [jobId, userId],
  );

  enqueueAnalysis({ jobId, userId, analysisNote: preflight.analysisNote });
  if (clearedClassifications > 0) {
    console.info(`[analysis:${jobId}] cleared previous classifications user=${userId} count=${clearedClassifications}`);
  }
  return { jobId, state: "queued", refreshed: clearedClassifications > 0, clearedClassifications };
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

  res.status(402).json({
    error: "Payment is required before running analysis. Use /api/analysis/checkout/start.",
  });
});

async function handleAnalysisCheckoutStart(req: Request, res: Response): Promise<void> {
  const parsed = analysisCheckoutStartSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const checkout = await startAnalysisCheckoutForUser(req.user!.id, parsed.data);
    res.status(201).json(checkout);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start checkout";
    if (/required before analysis|Profile must be saved/i.test(message)) {
      res.status(400).json({ error: message });
      return;
    }
    if (/Stripe|STRIPE_/i.test(message)) {
      res.status(502).json({ error: message });
      return;
    }
    res.status(500).json({ error: message });
    return;
  }
}

apiRouter.post("/analysis/checkout/start", handleAnalysisCheckoutStart);
apiRouter.post("/create-checkout-session", handleAnalysisCheckoutStart);

apiRouter.get("/verify-session", async (req, res) => {
  const sessionId = typeof req.query.session_id === "string" ? req.query.session_id.trim() : "";
  if (!sessionId) {
    res.status(400).json({ error: "session_id query parameter is required." });
    return;
  }

  const payment = await findAnalysisPaymentSession(req.user!.id, sessionId);
  if (!payment) {
    res.status(404).json({ error: "Checkout session not found." });
    return;
  }

  let session: StripeCheckoutSession;
  try {
    session = await stripeRetrieveCheckoutSession(sessionId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to verify checkout session";
    res.status(502).json({ error: message });
    return;
  }

  if (session.mode !== "payment" || session.payment_status !== "paid") {
    res.json({ success: false });
    return;
  }

  if (session.metadata?.userId && session.metadata.userId !== req.user!.id) {
    res.status(403).json({ error: "Checkout session ownership mismatch." });
    return;
  }

  await query(
    `UPDATE analysis_payment_sessions
     SET status = CASE WHEN status = 'created' THEN 'paid' ELSE status END,
         paid_at = COALESCE(paid_at, NOW()),
         updated_at = NOW()
     WHERE id = $1`,
    [payment.id],
  );

  const metadata: Record<string, string> = {
    ...(session.metadata ?? {}),
    userId: req.user!.id,
  };
  if (payment.ingestionJobId) {
    metadata.ingestionJobId = payment.ingestionJobId;
  }
  if (payment.analysisNote) {
    metadata.analysisNote = payment.analysisNote;
  }

  res.json({ success: true, metadata });
});

async function handleAnalysisCheckoutFinalize(req: Request, res: Response): Promise<void> {
  const parsed = analysisCheckoutFinalizeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const payment = await findAnalysisPaymentSession(req.user!.id, parsed.data.checkoutSessionId);
  if (!payment) {
    res.status(404).json({ error: "Checkout session not found." });
    return;
  }

  if (payment.analysisJobId) {
    const status = await findAnalysisJobStatus(req.user!.id, payment.analysisJobId);
    if (status) {
      res.status(200).json({ ...status, refreshed: false, clearedClassifications: 0 });
      return;
    }
  }

  let session: StripeCheckoutSession;
  try {
    session = await stripeRetrieveCheckoutSession(parsed.data.checkoutSessionId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to verify checkout session";
    res.status(502).json({ error: message });
    return;
  }

  if (session.mode !== "payment" || session.payment_status !== "paid") {
    res.status(400).json({ error: "Checkout session is not paid." });
    return;
  }
  if (session.metadata?.userId && session.metadata.userId !== req.user!.id) {
    res.status(403).json({ error: "Checkout session ownership mismatch." });
    return;
  }

  await query(
    `UPDATE analysis_payment_sessions
     SET status = CASE WHEN status = 'created' THEN 'paid' ELSE status END,
         paid_at = COALESCE(paid_at, NOW()),
         updated_at = NOW()
     WHERE id = $1`,
    [payment.id],
  );

  let started: AnalysisStartOutcome;
  try {
    started = await enqueueAnalysisStart(req.user!.id, {
      ingestionJobId: payment.ingestionJobId ?? undefined,
      analysisNote: payment.analysisNote ?? undefined,
    });
  } catch (error) {
    await query(
      `UPDATE analysis_payment_sessions
       SET status = 'failed', updated_at = NOW()
       WHERE id = $1`,
      [payment.id],
    );
    const message = error instanceof Error ? error.message : "Unable to start analysis";
    res.status(400).json({ error: message });
    return;
  }

  const consumed = await query(
    `UPDATE analysis_payment_sessions
     SET status = 'consumed', analysis_job_id = $1, consumed_at = NOW(), updated_at = NOW()
     WHERE id = $2
       AND analysis_job_id IS NULL`,
    [started.jobId, payment.id],
  );

  if (!consumed.rowCount) {
    const latestJobId = (await findAnalysisPaymentSession(req.user!.id, parsed.data.checkoutSessionId))?.analysisJobId;
    if (latestJobId) {
      const status = await findAnalysisJobStatus(req.user!.id, latestJobId);
      if (status) {
        res.status(200).json({ ...status, refreshed: false, clearedClassifications: 0 });
        return;
      }
    }
  }

  res.status(202).json(started);
}

apiRouter.post("/analysis/checkout/finalize", handleAnalysisCheckoutFinalize);
apiRouter.post("/run-analysis", handleAnalysisCheckoutFinalize);

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

apiRouter.get("/transactions/chat/eligibility", async (req, res) => {
  const payload = await getTransactionChatEligibility(req.user!.id);
  res.json(payload);
});

apiRouter.delete("/transactions/chat/history", async (req, res) => {
  await clearTransactionChatHistory(req.user!.id);
  res.status(204).send();
});

apiRouter.post("/transactions/chat", async (req, res) => {
  const parsed = transactionChatSendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const row = await sendTransactionChatMessage({ userId: req.user!.id, message: parsed.data.message });
    res.status(201).json({ row });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send chat message";
    res.status(400).json({ error: message });
  }
});
