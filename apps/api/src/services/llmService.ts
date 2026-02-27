import { GoogleGenAI, Type } from "@google/genai";
import { analysisResultSchema } from "@writeoffs/shared";
import { ZodError } from "zod";
import { env } from "../config/env.js";
import { buildBusinessContextPrompt } from "./businessProfileService.js";
import { normalizeCategory } from "../utils/category.js";

type InputTx = {
  id: string;
  date: string;
  description: string;
  amount: string;
  institution: string;
  transaction_type: string;
};

type ModelClassification = ReturnType<typeof analysisResultSchema.parse>[number];

export type ClassifiedTransaction = ModelClassification & {
  transactionId: string;
};

type ClassificationAttemptResult = {
  result: ClassifiedTransaction;
  retries: number;
  fallback: boolean;
  skipped: boolean;
};

class OutputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutputValidationError";
  }
}

export async function classifyTransactions(input: {
  businessType: string;
  aggressivenessLevel: string;
  analysisNote?: string;
  transactions: InputTx[];
}): Promise<ClassifiedTransaction[]> {
  const nonLlmResults = input.transactions
    .filter((tx) => tx.description.toLowerCase().includes("automatic payment"))
    .map((tx) =>
      toClassifiedTransaction(
        tx.id,
        fallbackClassification("Description contains 'automatic payment'; model skipped."),
      ),
    );

  const llmCandidates = input.transactions.filter((tx) => !tx.description.toLowerCase().includes("automatic payment"));
  if (!llmCandidates.length) {
    console.info(`[analysis:llm] batch summary size=${input.transactions.length} success=0 fallback=0 retries=0 skipped=${nonLlmResults.length}`);
    return nonLlmResults;
  }

  if (!env.GEMINI_API_KEY) {
    return [
      ...nonLlmResults,
      ...llmCandidates.map((tx) => toClassifiedTransaction(tx.id, fallbackClassification("GEMINI_API_KEY not configured; defaulted classification."))),
    ];
  }

  const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const analysisNote = input.analysisNote?.trim();
  const attempts = await Promise.all(
    llmCandidates.map(async (tx) => classifyTransactionWithRetry(client, input.businessType, input.aggressivenessLevel, tx, analysisNote)),
  );
  const retries = attempts.reduce((sum, item) => sum + item.retries, 0);
  const fallbackCount = attempts.filter((item) => item.fallback).length;
  const skippedCount = attempts.filter((item) => item.skipped).length + nonLlmResults.length;
  const successCount = attempts.length - fallbackCount;
  console.info(
    `[analysis:llm] batch summary size=${input.transactions.length} success=${successCount} fallback=${fallbackCount} retries=${retries} skipped=${skippedCount}`,
  );

  const llmResults = attempts.map((item) => item.result);
  const byId = new Map([...nonLlmResults, ...llmResults].map((result) => [result.transactionId, result]));
  return input.transactions
    .map((tx) => byId.get(tx.id))
    .filter((result): result is ClassifiedTransaction => Boolean(result));
}

async function classifyTransactionWithRetry(
  client: GoogleGenAI,
  businessType: string,
  aggressivenessLevel: string,
  tx: InputTx,
  analysisNote?: string,
): Promise<ClassificationAttemptResult> {
  const maxAttempts = env.LLM_MAX_RETRIES + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const classified = await classifySingleTransaction(client, businessType, aggressivenessLevel, tx, analysisNote);
      return { result: toClassifiedTransaction(tx.id, classified), retries: attempt - 1, fallback: false, skipped: false };
    } catch (error) {
      const reasonClass = classifyErrorReason(error);
      const retryable = isRetryableModelError(error);

      if (!retryable) {
        throw error;
      }

      if (attempt < maxAttempts) {
        const delayMs = backoffMs(attempt);
        console.warn(`[analysis:llm] ${reasonClass} on tx=${tx.id}, attempt=${attempt}/${maxAttempts}, retrying in ${delayMs}ms`);
        await sleep(delayMs);
        continue;
      }

      const message =
        reasonClass === "output_validation"
          ? "Model output invalid after retries; default applied."
          : "Model request failed after retries; default applied.";
      console.warn(`[analysis:llm] fallback on tx=${tx.id} reason=${reasonClass} attempts=${attempt}/${maxAttempts}`);
      return {
        result: toClassifiedTransaction(tx.id, fallbackClassification(message)),
        retries: attempt - 1,
        fallback: true,
        skipped: false,
      };
    }
  }

  return {
    result: toClassifiedTransaction(tx.id, fallbackClassification("Classification retry loop exhausted; default applied.")),
    retries: maxAttempts - 1,
    fallback: true,
    skipped: false,
  };
}

async function classifySingleTransaction(
  client: GoogleGenAI,
  businessType: string,
  aggressivenessLevel: string,
  tx: InputTx,
  analysisNote?: string,
): Promise<ModelClassification> {
  const businessContext = buildBusinessContextPrompt(businessType);
  const userNoteSection = analysisNote ? ["", "User-provided focus note (optional):", analysisNote] : [];
  const prompt = [
    `You are an expert U.S. tax accountant for a ${businessType}.`,
    "",
    "Task:",
    "Classify a single transaction as a likely deductible business expense or not, based only on provided fields.",
    "Input fields:",
    "- date",
    "- description (merchant/payee)",
    "- amount",
    "- transaction_type",
    "",
    "Decision objective:",
    `Use a ${aggressivenessLevel} posture, but only mark deductible when business purpose is clear and defensible.`,
    "If information is ambiguous or insufficient, default to not deductible.",
    "Small amounts do not relax substantiation standards.",
    "",
    "Profile context to apply:",
    ...businessContext,
    "",
    "Strict rules:",
    "- Commuting is not deductible unless input clearly indicates travel between business locations, to client/temporary site, or business trip transport.",
    "- Meals are not deductible unless the input clearly indicates a bona fide business meal.",
    "- Gray-area purchases require explicit business context in the transaction details; otherwise treat as non-deductible.",
    "- Hardware/equipment may be deductible only when business use is clearly indicated.",
    "- Internet/phone/utilities may involve partial business use, but require clear business linkage in provided details.",
    "- Books/media should be treated as deductible only when clearly professional/technical in context.",
    "",
    "Tie-breaker:",
    "If not clearly a legitimate business expense from the provided data, set is_deductible to false.",
    "",
    "Output requirements:",
    "Return exactly one JSON object matching the required schema with fields:",
    "- category (string)",
    "- is_deductible (boolean)",
    "- reasoning (string)",
    "No markdown, no extra keys, no extra text.",
    ...userNoteSection,
    "",
    "Transaction JSON:",
    JSON.stringify(tx),
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
          category: { type: Type.STRING },
          is_deductible: { type: Type.BOOLEAN },
          reasoning: { type: Type.STRING },
        },
        required: ["category", "is_deductible", "reasoning"],
      },
    },
  });

  const payload = response.text;
  if (!payload) {
    throw new Error(`Gemini response was empty for transaction ${tx.id}`);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(payload);
  } catch (error) {
    throw new OutputValidationError(`Model returned invalid JSON: ${(error as Error).message}`);
  }

  try {
    return analysisResultSchema.parse([parsedJson])[0];
  } catch (error) {
    if (error instanceof ZodError) {
      throw new OutputValidationError(`Model output schema mismatch: ${error.message}`);
    }
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  const exponential = env.LLM_RETRY_BASE_MS * 2 ** (attempt - 1);
  const jitter = Math.floor(Math.random() * env.LLM_RETRY_BASE_MS);
  return exponential + jitter;
}

function isRetryableModelError(error: unknown): boolean {
  if (error instanceof OutputValidationError) {
    return true;
  }

  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (
    message.includes("rate limit") ||
    message.includes("quota") ||
    message.includes("resource_exhausted") ||
    message.includes("429") ||
    message.includes("503") ||
    message.includes("unavailable") ||
    message.includes("high demand") ||
    message.includes("deadline exceeded") ||
    message.includes("temporar")
  ) {
    return true;
  }

  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: number | string }).status;
    if (status === 429 || status === 503 || status === "UNAVAILABLE") {
      return true;
    }
  }

  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: number | string }).code;
    if (code === 429 || code === 503 || code === "UNAVAILABLE") {
      return true;
    }
  }

  if (typeof error === "object" && error !== null && "error" in error) {
    const nested = (error as { error?: { code?: number; status?: string; message?: string } }).error;
    const nestedMessage = nested?.message?.toLowerCase() ?? "";
    if (nested?.code === 429 || nested?.code === 503 || nested?.status === "UNAVAILABLE" || nestedMessage.includes("high demand")) {
      return true;
    }
  }

  if (error instanceof Error && typeof (error as { cause?: unknown }).cause === "object" && (error as { cause?: unknown }).cause !== null) {
    const cause = (error as { cause?: { code?: number; status?: string } }).cause!;
    if (cause.code === 429 || cause.code === 503 || cause.status === "UNAVAILABLE") {
      return true;
    }
  }

  if (typeof error === "object" && error !== null && "status" in error && (error as { status?: number }).status === 429) {
    return true;
  }

  return false;
}

function classifyErrorReason(error: unknown): "output_validation" | "provider_transient" | "unknown" {
  if (error instanceof OutputValidationError) {
    return "output_validation";
  }
  if (isRetryableModelError(error)) {
    return "provider_transient";
  }
  return "unknown";
}

function fallbackClassification(reasoning: string): ModelClassification {
  return {
    category: "Uncategorized",
    is_deductible: false,
    reasoning,
  };
}

function toClassifiedTransaction(transactionId: string, classification: ModelClassification): ClassifiedTransaction {
  return {
    transactionId,
    category: normalizeCategory(classification.category),
    is_deductible: classification.is_deductible,
    reasoning: classification.reasoning,
  };
}
