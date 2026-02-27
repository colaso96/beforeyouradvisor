Here is the technical implementation plan formatted as a hand-off specification for a software engineer.

# Engineering Spec: AI Financial Statement Classifier

## 1. Stack & Dependencies

* **Frontend:** React (Vite or Next.js), TailwindCSS, Axios/Fetch.
* **Backend:** Node.js, Express.js.
* **Database:** PostgreSQL (with `pg` and `knex` or Prisma ORM).
* **Authentication:** Passport.js (`passport-google-oauth20`).
* **Google APIs:** `@googleapis/drive` (v3), `@google-cloud/documentai` (for PDF OCR).
* **Data Parsing:** `csv-parser` or `papaparse` (Node stream parsing).
* **LLM Integration:** `openai` or `@google/generative-ai` (using Structured Outputs/JSON Schema).
* **Job Queue (Async Batching):** `pg-boss` (uses PostgreSQL to avoid needing a separate Redis instance) or simple async worker pattern.

---

## 2. Database Schema (PostgreSQL)

**Table: `users**`

* `id` (UUID, Primary Key)
* `google_id` (String, Unique) - For OAuth.
* `email` (String, Unique)
* `business_type` (String, Nullable) - e.g., "Freelance Designer".
* `aggressiveness_level` (String, Nullable) - "Conservative", "Moderate", "Aggressive".
* `created_at` / `updated_at` (Timestamps)

**Table: `transactions**`

* `id` (UUID, Primary Key)
* `user_id` (UUID, Foreign Key -> users.id)
* `date` (Date)
* `institution` (Enum: 'CHASE', 'AMEX', 'COINBASE')
* `description` (Text)
* `amount` (Numeric/Decimal) - Absolute value.
* `transaction_type` (Enum: 'DEBIT', 'CREDIT') - DEBIT = Expense, CREDIT = Payment/Income.
* `llm_category` (String, Nullable)
* `is_deductible` (Boolean, Nullable)
* `llm_reasoning` (Text, Nullable)
* `raw_data` (JSONB) - Store the original unparsed row for auditing.

---

## 3. Implementation Phases

### Phase 1: Setup & Authentication

1. **GCP Project:** Create a Google Cloud Project. Enable Google Drive API and Document AI API. Generate OAuth 2.0 Client IDs.
2. **Auth Flow:** Implement a `/auth/google` route in Express. Request scopes: `profile`, `email`, and `https://www.googleapis.com/auth/drive.readonly`.
3. **Session Management:** Store user sessions via HTTP-only cookies or JWTs.
4. **Frontend:** Build the login view and a dashboard containing the "Business Profile" form (Business Type and Aggressiveness Level inputs) and the "Drive Folder URL" input.

### Phase 2: Ingestion & Document AI Processing

1. **Extract Folder ID:** Write a regex utility to parse the Google Drive Folder ID from standard URLs.
2. **Drive File Fetching:** Create a service to call `drive.files.list`, filtering for `mimeType` matching `text/csv` and `application/pdf` within the target folder.
3. **Download & Parse:**
* **CSVs:** Stream download via Drive API and pipe into `csv-parser`.
* **PDFs (Coinbase):** Stream download, convert to base64 or buffer, and send to Google Document AI (`processDocument` endpoint using a Form Parser or Expense Parser processor). Extract tabular data mapping to Date, Description, and Amount.



### Phase 3: Data Normalization (Adapter Pattern)

Create an ingestion pipeline that normalizes the extracted data into the `transactions` schema before database insertion.

* **Chase CSV Adapter:**
* Map `Transaction Date` -> `date`.
* Map `Description` -> `description`.
* **Signage Logic:** If `Amount` is negative, set `transaction_type` to `DEBIT` and store `amount` as absolute. If positive, set to `CREDIT`.


* **Amex CSV Adapter:**
* Map `Date` -> `date`.
* **Signage Logic:** If `Amount` is positive, set `transaction_type` to `DEBIT`. If negative, set to `CREDIT` (reverse of Chase).


* **Coinbase PDF Adapter (Post-Doc AI):**
* Clean strings: Strip `$` and `,` from amounts. Cast to Float.
* Map extracted Purchases to `DEBIT`.



**Action:** Bulk insert the normalized arrays into the PostgreSQL `transactions` table.

### Phase 4: User Configuration

1. **API Endpoint:** `PUT /api/users/profile` to update `business_type` and `aggressiveness_level`.
2. **State sync:** Ensure the frontend forces the user to set these parameters before the "Run AI Analysis" button becomes clickable.

### Phase 5: Async LLM Batching

1. **Trigger Endpoint:** `POST /api/analysis/start`. This creates a job in the queue (e.g., `pg-boss`) and immediately returns a `202 Accepted` status to the frontend.
2. **Worker Logic (Background Process):**
* Fetch user parameters (`business_type`, `aggressiveness`).
* Fetch all unclassified transactions (`llm_category IS NULL`) for the user.
* **Chunking:** Split the records into batches of 100 to fit LLM context limits and ensure reliable structured outputs.


3. **LLM Invocation:**
* **System Prompt:** *"You are an expert tax accountant for a [business_type]. Scan these transactions with a [aggressiveness] approach to identifying tax deductions. Categorize each and flag if deductible."*
* **Schema Enforcement:** Use JSON Schema in the API call to force the LLM to return an array of objects: `[{ transaction_id: UUID, category: string, is_deductible: boolean, reasoning: string }]`.


4. **Database Updates:** Iterate through the LLM response array and perform a bulk `UPDATE` on the `transactions` table.
5. **Polling/Websockets:** Implement a lightweight polling mechanism (`GET /api/analysis/status`) on the React side to show progress (e.g., "Processed 300/450 transactions") and refresh the data table upon completion.

### Phase 6: Interactive Data Chat (Follow-up)

* **Scope:** Pushed to a follow-up effort. Will involve creating a `chat_history` table and a RAG (Retrieval-Augmented Generation) or SQL-generating LLM agent to query the classified PostgreSQL data.