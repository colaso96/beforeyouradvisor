import { z } from "zod";

export const aggressivenessSchema = z.enum(["CONSERVATIVE", "MODERATE", "AGGRESSIVE"]);

export const profileSchema = z.object({
  businessType: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9_]+$/, "businessType must be a canonical key (lowercase letters, numbers, underscores)."),
  aggressivenessLevel: aggressivenessSchema,
});

export const ingestionStartSchema = z.object({
  driveFolderUrl: z.string().min(1),
});

export const analysisStartSchema = z.object({
  ingestionJobId: z.string().uuid().optional(),
  analysisNote: z.string().trim().max(500).optional(),
});

export const analysisCheckoutStartSchema = analysisStartSchema;

export const analysisCheckoutFinalizeSchema = z.object({
  checkoutSessionId: z.string().trim().min(1),
});

export const transactionChatSendSchema = z.object({
  message: z.string().trim().min(1).max(2000),
});

export const transactionChatTableSchema = z.object({
  columns: z.array(z.string().min(1)).max(100),
  rows: z.array(z.record(z.unknown())).max(100),
});

export const transactionChatMessageSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
  sql: z.string().min(1).nullable(),
  resultTable: transactionChatTableSchema.nullable(),
  createdAt: z.string().min(1),
});

export const transactionTypeSchema = z.enum(["DEBIT", "CREDIT"]);

export const institutionSchema = z.enum(["CHASE", "AMEX", "COINBASE"]);

export const analysisResultSchema = z.array(
  z.object({
    category: z.string().min(1),
    is_deductible: z.boolean(),
    reasoning: z.string().min(1),
  }),
);

export type AggressivenessLevel = z.infer<typeof aggressivenessSchema>;
export type ProfileInput = z.infer<typeof profileSchema>;
export type IngestionStartInput = z.infer<typeof ingestionStartSchema>;
export type AnalysisStartInput = z.infer<typeof analysisStartSchema>;
export type AnalysisCheckoutStartInput = z.infer<typeof analysisCheckoutStartSchema>;
export type AnalysisCheckoutFinalizeInput = z.infer<typeof analysisCheckoutFinalizeSchema>;
export type TransactionChatSendInput = z.infer<typeof transactionChatSendSchema>;
export type TransactionChatTable = z.infer<typeof transactionChatTableSchema>;
export type TransactionChatMessage = z.infer<typeof transactionChatMessageSchema>;
export type TransactionType = z.infer<typeof transactionTypeSchema>;
export type Institution = z.infer<typeof institutionSchema>;
export type AnalysisResult = z.infer<typeof analysisResultSchema>[number];
