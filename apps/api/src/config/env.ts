import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRootEnvPath = resolve(currentDir, "../../../../.env");

if (existsSync(repoRootEnvPath)) {
  dotenv.config({ path: repoRootEnvPath });
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_CALLBACK_URL: z.string().url(),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().min(1).default("gemini-2.5-flash-lite"),
  ANALYSIS_BATCH_SIZE: z.coerce.number().int().positive().default(10),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).default(4),
  LLM_RETRY_BASE_MS: z.coerce.number().int().positive().default(500),
});

export const env = envSchema.parse(process.env);
