# writeoffs-gpt

Monorepo implementation of the AI Financial Statement Classifier plan.

## Structure

- `apps/api`: Express + PostgreSQL backend with Google OAuth, ingestion jobs, and analysis jobs.
- `apps/web`: React + Vite dashboard for profile, ingestion, and analysis workflows.
- `packages/shared`: Shared Zod schemas and types used by both apps.

## Implemented phases

- Phase 1: setup, env validation, session auth, Google OAuth endpoints, protected dashboard flow.
- Phase 2: Drive folder ID parsing, Drive file listing/downloading, CSV parsing, local Coinbase PDF extraction (`pdfjs-dist` + regex section parsing), async ingestion jobs.
- Phase 3: Chase/Amex/Coinbase normalization adapters, amount sign handling, dedup hashing, bulk inserts.
- Phase 4: profile API + frontend gating before ingestion/analysis.
- Phase 5: async analysis job worker, configurable batching (default `10`), per-transaction async LLM calls, rate-limit retry/backoff, progress polling.

## API endpoints

- `GET /auth/google`
- `GET /auth/google/callback`
- `POST /auth/logout`
- `GET /api/me`
- `PUT /api/users/profile`
- `POST /api/ingestion/start`
- `GET /api/ingestion/status/:jobId`
- `POST /api/analysis/start`
- `GET /api/analysis/status/:jobId`
- `GET /api/transactions?limit=&offset=&status=`

## Local setup

1. Copy `.env.example` to `.env` and set credentials.
2. Start local Postgres with Docker:
   `docker compose up -d postgres`
3. Install dependencies: `npm install`.
4. Run backend: `npm run -w apps/api dev`.
5. Run frontend: `npm run -w apps/web dev`.

To stop Postgres:
`docker compose down`

Default Postgres host port for this project is `5433` to avoid collisions with other local Postgres containers.

## Notes

- If `GEMINI_API_KEY` is not set, analysis uses a safe fallback classification.
- Coinbase PDF parsing runs locally in the API process (no paid OCR dependency).
- Analysis tuning env vars:
  - `ANALYSIS_BATCH_SIZE` (default `10`)
  - `LLM_MAX_RETRIES` (default `4`, retries only on rate-limit style errors)
  - `LLM_RETRY_BASE_MS` (default `500`, exponential backoff base)
