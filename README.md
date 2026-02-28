# Deductions GPT

Monorepo implementation of the AI Financial Statement Classifier plan.

## Structure

- `apps/api`: Express + PostgreSQL backend with Google OAuth, ingestion jobs, and analysis jobs.
- `apps/web`: React + Vite dashboard for profile, ingestion, and analysis workflows.
- `packages/shared`: Shared Zod schemas and types used by both apps.

## Implemented Features

- setup, env validation, session auth, Google OAuth endpoints, protected dashboard flow.
- Drive folder ID parsing, Drive file listing/downloading, CSV parsing, local Coinbase PDF extraction (`pdfjs-dist` + regex section parsing), async ingestion jobs.
- Chase/Amex/Coinbase normalization adapters, amount sign handling, dedup hashing, bulk inserts.
- profile API + frontend gating before ingestion/analysis.
- async analysis job worker, configurable batching (default `10`), per-transaction async LLM calls, rate-limit retry/backoff, progress polling.
- chat with your data card that writes sql and then summarizes the results


## API endpoints

- `GET /auth/google`
- `GET /auth/google/callback`
- `POST /auth/logout`
- `GET /api/me`
- `PUT /api/users/profile`
- `POST /api/ingestion/start`
- `GET /api/ingestion/status/:jobId`
- `POST /api/analysis/start`
- `POST /api/analysis/checkout/start`
- `POST /api/create-checkout-session` (alias of checkout/start)
- `GET /api/verify-session?session_id=...`
- `POST /api/analysis/checkout/finalize`
- `POST /api/run-analysis` (alias of checkout/finalize)
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

## VPS deployment with Docker

This repo includes a production Docker stack with:

- `app`: Express API + built React frontend served from the same container/origin.
- `postgres`: PostgreSQL 16 with persistent Docker volume.
- `caddy`: reverse proxy + automatic TLS certificates for HTTPS.

### 1. Prepare production env file

1. Copy `.env.production.example` to `.env.production`.
2. Fill in all secrets and production values.
3. Keep these aligned:
   - `APP_ORIGIN=https://beforeyouradvisor.com`
   - `GOOGLE_CALLBACK_URL=https://beforeyouradvisor.com/auth/google/callback`
   - `STRIPE_SUCCESS_URL=https://beforeyouradvisor.com/?checkout_session_id={CHECKOUT_SESSION_ID}`
   - `STRIPE_CANCEL_URL=https://beforeyouradvisor.com/?checkout_cancelled=1`
   - `DATABASE_URL=postgres://<user>:<password>@postgres:5432/<db>`
4. Set `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` to match `DATABASE_URL`.

### 2. Build and run on VPS

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Check services:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f app
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f caddy
```

Stop stack:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml down
```

The Postgres volume (`beforeyouradvisor_pgdata`) keeps data between restarts.

### 3. Update external providers

- Google OAuth allowed origin: `https://beforeyouradvisor.com`
- Google OAuth callback: `https://beforeyouradvisor.com/auth/google/callback`
- Stripe checkout return URLs should match the values in `.env.production`

## Where to get google credentials
To get this project running, you’ll need to acquire API credentials from Google. Create a `.env` file in the root directory and populate it using the guide below.

### 1. Google OAuth Credentials (`CLIENT_ID` & `SECRET`)

These are required for Google Login.

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. **Create a New Project** (or select an existing one).
3. Navigate to **APIs & Services > OAuth consent screen**. Complete the internal/external setup.
4. Go to **Credentials > Create Credentials > OAuth client ID**.
5. Select **Web application** as the application type.
6. **Authorized Redirect URIs**: Add `http://localhost:4000/auth/google/callback` (or your specific callback URL).
7. Copy the **Client ID** and **Client Secret** into your `.env`.

### 2. Gemini API Key

This powers the AI features of the application.

1. Visit [Google AI Studio](https://aistudio.google.com/).
2. Sign in with your Google account.
3. Click on **"Get API key"** in the sidebar.
4. Click **"Create API key in new project"**.
5. Copy the generated key and paste it into `GEMINI_API_KEY`.

### 3. Google Callback URL

This must match the URL you whitelisted in the Google Cloud Console. For local development, this is typically:
`http://localhost:4000/auth/google/callback`


## Notes

- If `GEMINI_API_KEY` is not set, analysis uses a safe fallback classification.
- Coinbase PDF parsing runs locally in the API process (no paid OCR dependency).
- Analysis tuning env vars:
  - `ANALYSIS_BATCH_SIZE` (default `10`)
  - `LLM_MAX_RETRIES` (default `4`, retries only on rate-limit style errors)
  - `LLM_RETRY_BASE_MS` (default `500`, exponential backoff base)
