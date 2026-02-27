import { classifyTransactions } from "../services/llmService.js";
import { query } from "../db/client.js";
import { env } from "../config/env.js";
import { errorToLogString } from "../utils/errorLog.js";

type TxRow = {
  id: string;
  date: string;
  description: string;
  amount: string;
  institution: string;
  transaction_type: string;
};

type UserConfig = {
  business_type: string | null;
  aggressiveness_level: string | null;
};

export async function runAnalysisJob(jobId: string, userId: string, analysisNote?: string): Promise<void> {
  const batchSize = env.ANALYSIS_BATCH_SIZE;
  console.info(`[analysis:${jobId}] starting job for user=${userId} batchSize=${batchSize}`);
  await query("UPDATE analysis_jobs SET status = 'running', started_at = NOW(), updated_at = NOW() WHERE id = $1", [jobId]);

  try {
    const user = await query<UserConfig>("SELECT business_type, aggressiveness_level FROM users WHERE id = $1", [userId]);
    const config = user.rows[0];
    if (!config?.business_type || !config.aggressiveness_level) {
      throw new Error("User profile is incomplete");
    }

    const totalRes = await query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM transactions WHERE user_id = $1 AND transaction_type = 'DEBIT' AND llm_category IS NULL",
      [userId],
    );
    const total = Number(totalRes.rows[0]?.count ?? "0");
    await query("UPDATE analysis_jobs SET total = $1, updated_at = NOW() WHERE id = $2", [total, jobId]);
    console.info(`[analysis:${jobId}] total unclassified transactions=${total}`);

    let processed = 0;
    let batchNumber = 0;
    while (true) {
      const batch = await query<TxRow>(
        `SELECT id, date::text, description, amount::text, institution, transaction_type
         FROM transactions
         WHERE user_id = $1 AND transaction_type = 'DEBIT' AND llm_category IS NULL
         ORDER BY date ASC, id ASC
         LIMIT $2`,
        [userId, batchSize],
      );

      if (!batch.rowCount) break;
      batchNumber += 1;
      console.info(`[analysis:${jobId}] batch ${batchNumber} fetched size=${batch.rowCount}`);

      const classified = await classifyTransactions({
        businessType: config.business_type,
        aggressivenessLevel: config.aggressiveness_level,
        analysisNote,
        transactions: batch.rows,
      });
      console.info(`[analysis:${jobId}] batch ${batchNumber} classified count=${classified.length}`);

      for (const result of classified) {
        await query(
          `UPDATE transactions
           SET llm_category = $1, is_deductible = $2, llm_reasoning = $3, updated_at = NOW()
           WHERE id = $4 AND user_id = $5`,
          [result.category, result.is_deductible, result.reasoning, result.transactionId, userId],
        );
      }

      processed += batch.rowCount;
      await query("UPDATE analysis_jobs SET processed = $1, updated_at = NOW() WHERE id = $2", [processed, jobId]);
      console.info(`[analysis:${jobId}] batch ${batchNumber} committed progress=${processed}/${total}`);
    }

    await query("UPDATE analysis_jobs SET status = 'completed', finished_at = NOW(), updated_at = NOW() WHERE id = $1", [jobId]);
    console.info(`[analysis:${jobId}] completed processed=${processed}/${total}`);
  } catch (error) {
    const publicError = "Analysis failed due to temporary model availability issues. Please retry shortly.";
    await query("UPDATE analysis_jobs SET status = 'failed', error = $1, finished_at = NOW(), updated_at = NOW() WHERE id = $2", [
      publicError,
      jobId,
    ]);
    console.error(`[analysis:${jobId}] failed: ${errorToLogString(error)}`);
  }
}
