import { query } from "./client.js";

export async function ensureSchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      google_id TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      business_type TEXT,
      aggressiveness_level TEXT CHECK (aggressiveness_level IN ('CONSERVATIVE', 'MODERATE', 'AGGRESSIVE')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ingestion_jobs (
      id UUID PRIMARY KEY,
      user_id UUID REFERENCES users(id) NOT NULL,
      status TEXT NOT NULL,
      drive_folder_id TEXT,
      total_files INT NOT NULL DEFAULT 0,
      processed_files INT NOT NULL DEFAULT 0,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS analysis_jobs (
      id UUID PRIMARY KEY,
      user_id UUID REFERENCES users(id) NOT NULL,
      status TEXT NOT NULL,
      total INT NOT NULL DEFAULT 0,
      processed INT NOT NULL DEFAULT 0,
      error TEXT,
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id UUID PRIMARY KEY,
      user_id UUID REFERENCES users(id) NOT NULL,
      date DATE NOT NULL,
      institution TEXT NOT NULL CHECK (institution IN ('CHASE', 'AMEX', 'COINBASE')),
      description TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      transaction_type TEXT NOT NULL CHECK (transaction_type IN ('DEBIT', 'CREDIT')),
      llm_category TEXT,
      is_deductible BOOLEAN,
      llm_reasoning TEXT,
      raw_data JSONB NOT NULL,
      dedup_key TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS transaction_chat_messages (
      id UUID PRIMARY KEY,
      user_id UUID REFERENCES users(id) NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      sql_text TEXT,
      result_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS analysis_payment_sessions (
      id UUID PRIMARY KEY,
      user_id UUID REFERENCES users(id) NOT NULL,
      stripe_session_id TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('created', 'paid', 'consumed', 'expired', 'failed')),
      ingestion_job_id UUID REFERENCES ingestion_jobs(id),
      analysis_note TEXT,
      analysis_job_id UUID REFERENCES analysis_jobs(id),
      paid_at TIMESTAMPTZ,
      consumed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_user_category ON transactions(user_id, llm_category);
    CREATE INDEX IF NOT EXISTS idx_transaction_chat_messages_user_created_at
      ON transaction_chat_messages(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_analysis_payment_sessions_user_created_at
      ON analysis_payment_sessions(user_id, created_at DESC);
  `);
}
