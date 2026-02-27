# Interview Submission: How This Repo Works

This project solves a practical pain point for self-employed users: turning messy bank/card statements into a defensible, reviewable set of potential tax write-offs.  
The user connects Google Drive, uploads exported statements, and gets categorized debit transactions with deductible flags, reasoning, and CSV export.

## What the User Gets

- One flow from raw statements to analyzed expenses.
- Support for mixed source formats (Chase CSV, Amex CSV, Coinbase PDF).
- Business-context-aware classification using selected business profile + aggressiveness setting.
- Progress visibility for ingestion and analysis jobs, plus downloadable results.

## End-to-End Flow

1. User signs in with Google OAuth and grants Drive read-only access.
2. User submits a Drive folder URL.
3. Backend lists supported files, downloads each file, and normalizes rows into a shared transaction schema.
4. Normalized debit transactions are stored with raw source payload + dedup hash for auditability.
5. User saves business profile + aggressiveness level.
6. User starts analysis job; worker classifies transactions asynchronously with retry/fallback behavior.
7. UI polls status endpoints and renders classified transactions + category summary + CSV export.

## Key Design Choices and Why

- Monorepo with `apps/api`, `apps/web`, and `packages/shared`:
  Keeps API/frontend contracts aligned via shared Zod schemas and reduces drift.
- Session-based auth + Google OAuth:
  Practical for a web dashboard and required for Drive integration.
- Asynchronous job model for ingestion/analysis:
  Avoids request timeouts and supports progress polling on long-running work.
  Uses postgres as a job queue instead of something like Redis for simplicity.  At scale, this would need to be adjusted
- Adapter-based normalization per institution:
  Encodes source-specific sign/date quirks once, then writes consistent records downstream.
  Again at scale this would need to be easier for users to either add any csv or link their credit card companies data
- Local Coinbase PDF parsing (`pdfjs-dist`) instead of paid OCR dependency:
  Lowers runtime cost and keeps data extraction deterministic for this known statement format.
- Dedup key (`sha256` over canonical tx fields):
  Prevents duplicate inserts across repeated ingestions without complex reconciliation logic.
- Strict structured-output parsing for LLM responses (JSON schema + Zod validation):
  Improves reliability and safely falls back to conservative defaults on provider/output failures.
- Batch processing of LLM requests and retries with backoff on retryable errors like rate limits or structured output failures
- Profile gating before analysis:
  Forces user context to be explicit so classification decisions are explainable.
- Transaction reset on re-ingest / classification reset on re-analysis:
  Chooses data consistency and reproducibility over incremental merge complexity.

## Why These Tradeoffs Make Sense

- The system is optimized for correctness, traceability, and shipping velocity in an MVP.
- It intentionally uses a simple in-process queue first, which is easy to reason about and sufficient for early-stage load.
- The architecture leaves clear upgrade paths (external queue, more adapters, richer analysis) without reworking core contracts.
