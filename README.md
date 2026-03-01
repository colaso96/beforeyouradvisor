# BeforeYourAdvisor

Monorepo implementation of BeforeYourAdvisor, an AI powered tool to help determine which credit card transactions may be applicable for deductions with 1099 income.

## Structure

- `apps/api`: Express + PostgreSQL backend with Google OAuth, ingestion jobs, and analysis jobs.
- `apps/web`: React + Vite dashboard for profile, ingestion, and analysis workflows.
- `packages/shared`: Shared Zod schemas and types used by both apps.

## Implemented Features

- Session auth, Google OAuth endpoints to load files from drive, protected dashboard flow.
- Drive folder ID parsing, Drive file listing/downloading, CSV parsing, local Coinbase PDF extraction (`pdfjs-dist` + regex section parsing), async ingestion jobs.
- Chase/Amex/Coinbase normalization adapters, amount sign handling, dedup hashing, bulk inserts.
- profile API + frontend gating before ingestion/analysis.
- async analysis job worker, configurable batching (default `10`), per-transaction async LLM calls, rate-limit retry/backoff, progress polling.
- Chat with your data card that writes sql and then summarizes the results
- Stripe payment for analysis

## How to use
Go to https://beforeyouradvisor.com and make sure your email is added as a test user.  Google has a 7-10 review period for published apps so I am not able to make it generally accessible.  Please email colecrescas@gmail.com for your email to be added as a test user.  So far, I have added:
- brett@tenex.co
- alex@tenex.co
- arman@tenex.co
- dean@tenex.co
- dan@tenex.co

Pull your credit card transactions from either amex, chase or coinbase and put the files into your drive.

Login and copy a link to your drive in step 1, then select a business profile, enter some added optional info and click run analysis.  This will take you to a fake stripe landing page which you can use fake info and the card number 4242 4242 4242 4242 and an expiration date in the future.

From there you will be able to chat with your data which runs simple sql queries aginst the PG db and generates a summary, keeping the past 5 chats as memory. You can also download a csv of your labeled transactions or adjust your profile and run again.  Additionally, you can view transactions or a category roll-up table.

## Business Impact
This helped me prepare for my meeting with my CPA by generating some transactions that could potentially be deductible for the 2025 tax year.  For a $10 cost a freelancer or small business can find thousands in potentially deductible expenses for their business.  The user can also re-run the analysis at different aggressiveness levels and looking for different things.  

Aggregating and standardizing all data is also a large challenge and fantastic output of this tool. It is very similar to keepertax.com but I didn't want to pay for it. 


## What the User Gets

- One flow from raw statements to analyzed expenses.
- Support for mixed source formats (Chase CSV, Amex CSV, Coinbase PDF).
- Business-context-aware classification using selected business profile + aggressiveness setting.
- Progress visibility for ingestion and analysis jobs, plus downloadable results.
- Downloadable CSV to store for local records
- Chat with your data application for further analysis

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
- Strict structured-output parsing for LLM responses (JSON schema + Zod validation):
  Improves reliability and safely falls back to conservative defaults on provider/output failures.
- Batch processing of LLM requests and retries with backoff on retryable errors like rate limits or structured output failures
- Profile gating before analysis:
  Forces user context to be explicit so classification decisions are explainable.
- Transaction reset on re-ingest / classification reset on re-analysis:
  Chooses data consistency and reproducibility over incremental merge complexity.
- The architecture leaves upgrade paths (external queue, more adapters, richer analysis, linking to users credit card companies) without reworking core contracts.

## Tradeoffs

- The system is optimized for correctness, traceability, and shipping velocity in an MVP.
- Reading from a users drive instead of linking to their bank / credit card transactions due to project requirements and simplicty
- Background jobs are orchestrated by an in-memory queue in the BE process. This keeps architecture simple but ties execution capacity and resiliency to one app process.  Redis could be added later if needed for scale and reliability
- Analysis writes transaction updates one-by-one and the frontend uses a 2.5s polling strategy for job status rather than push channels (SSE/WebSocket)
- The deployment is very simple with one small stack of postgres + app + caddy with no auto-scaling.  The user base is capped up to 100 test users limited by google auth so the risk is small
- Secrets are loaded from an env file vs a secrets manager for simplicty.


## AI Tools Used
- Mostly gpt-5.3-codex from the codex CLI + gemini for high level planning & image generation
- 6 terminals running: 2 codex, 1 BE, 1 FE, 1 Docker, 1 for general use
- My workflow always starts in plan mode, instructing the LLM to analyze the repo context to make targeted changes, reviewing the plan in depth and then testing the implementation in small steps. - - Integration tests are preferred over unit tests especially on data parsing steps which are hard to debug.  For easily verifyable tasks it can be better to define a test harness first and then have the LLM work to write code that meets the test criteria, flipping the development process around can really help
- GEPA Algorithm for prompt optimization on an external web app.  GEPA is a really interesting algorithm which i attached some background in the GEPA folder.  I was able to generated some labeled data, split into training and val sets then optimized a prompt, resulting in an output prompt scoring 30% better on the test set.  Diving into GEPA could be a whole other project so I am keeping it high level for now.  Happy to talk more later

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