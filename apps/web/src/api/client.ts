const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

async function requestBlob(path: string, init?: RequestInit): Promise<Blob> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }

  return res.blob();
}

export type Me = {
  id: string;
  email: string;
  businessType: string | null;
  aggressivenessLevel: "CONSERVATIVE" | "MODERATE" | "AGGRESSIVE" | null;
};

export type BusinessProfileOption = {
  key: string;
  displayName: string;
  industry: string;
};

export type JobStatus = {
  jobId: string;
  state: "queued" | "running" | "completed" | "failed";
  processed: number;
  total: number;
  error: string | null;
};

export type TransactionRow = {
  id: string;
  date: string;
  institution: "CHASE" | "AMEX" | "COINBASE";
  description: string;
  amount: string;
  transactionType: "DEBIT" | "CREDIT";
  llmCategory: string | null;
  isDeductible: boolean | null;
  llmReasoning: string | null;
};

export type TransactionSummaryRow = {
  category: string;
  deductibleAmount: string;
  nonDeductibleAmount: string;
  deductibleCount: number;
  nonDeductibleCount: number;
  totalAmount: string;
  totalCount: number;
};

export type IngestionStartResponse = {
  jobId: string;
  state: string;
  refreshed: boolean;
  deletedTransactions: number;
};

export type AnalysisStartResponse = {
  jobId: string;
  state: string;
  refreshed: boolean;
  clearedClassifications: number;
};

type TransactionsQuery = {
  limit?: number;
  offset?: number;
  status?: "all" | "classified" | "unclassified";
  samplePerInstitution?: number;
};

function buildTransactionsQuery(input?: TransactionsQuery): string {
  if (!input) {
    return "/api/transactions?samplePerInstitution=3&limit=10";
  }

  const params = new URLSearchParams();
  if (input.limit != null) params.set("limit", String(input.limit));
  if (input.offset != null) params.set("offset", String(input.offset));
  if (input.status) params.set("status", input.status);
  if (input.samplePerInstitution != null) params.set("samplePerInstitution", String(input.samplePerInstitution));
  return `/api/transactions?${params.toString()}`;
}

export const api = {
  me: () => request<Me>("/api/me"),
  businessProfiles: () => request<{ rows: BusinessProfileOption[] }>("/api/business-profiles"),
  updateProfile: (input: { businessType: string; aggressivenessLevel: "CONSERVATIVE" | "MODERATE" | "AGGRESSIVE" }) =>
    request<void>("/api/users/profile", { method: "PUT", body: JSON.stringify(input) }),
  startIngestion: (driveFolderUrl: string) => request<IngestionStartResponse>("/api/ingestion/start", { method: "POST", body: JSON.stringify({ driveFolderUrl }) }),
  ingestionStatus: (jobId: string) => request<JobStatus>(`/api/ingestion/status/${jobId}`),
  startAnalysis: (input?: { ingestionJobId?: string; analysisNote?: string }) => {
    const body: { ingestionJobId?: string; analysisNote?: string } = {};
    if (input?.ingestionJobId) body.ingestionJobId = input.ingestionJobId;
    const trimmedNote = input?.analysisNote?.trim();
    if (trimmedNote) body.analysisNote = trimmedNote;
    return request<AnalysisStartResponse>("/api/analysis/start", { method: "POST", body: JSON.stringify(body) });
  },
  analysisStatus: (jobId: string) => request<JobStatus>(`/api/analysis/status/${jobId}`),
  transactionsSummary: () => request<{ rows: TransactionSummaryRow[] }>("/api/transactions/summary"),
  transactions: (query?: TransactionsQuery) => request<{ rows: TransactionRow[] }>(buildTransactionsQuery(query)),
  downloadTransactionsCsv: () => requestBlob("/api/transactions/export.csv"),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  authUrl: `${API_BASE}/auth/google`,
};
