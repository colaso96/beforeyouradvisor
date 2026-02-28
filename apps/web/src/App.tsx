import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type BusinessProfileOption,
  type JobStatus,
  type Me,
  type TransactionChatEligibility,
  type TransactionChatMessage,
  type TransactionRow,
  type TransactionSummaryRow,
} from "./api/client";
import { ToastViewport, useToastController } from "./toast";

const levels = ["CONSERVATIVE", "MODERATE", "AGGRESSIVE"] as const;

const sampleTransactions = [
  {
    id: "tx_9f31e9a2",
    date: "2026-02-12",
    institution: "Chase",
    description: "Figma Professional Plan",
    amount: "15.00",
    transactionType: "DEBIT",
    llmCategory: "Software & SaaS",
    isDeductible: true,
    llmReasoning: "Design subscription used for client projects.",
  },
  {
    id: "tx_7c4a321f",
    date: "2026-02-10",
    institution: "Amex",
    description: "Delta Flight - Client Shoot",
    amount: "286.40",
    transactionType: "DEBIT",
    llmCategory: "Travel",
    isDeductible: true,
    llmReasoning: "Travel cost tied to documented client assignment.",
  },
  {
    id: "tx_f0d3b44e",
    date: "2026-02-09",
    institution: "Chase",
    description: "Coffee Shop",
    amount: "9.75",
    transactionType: "DEBIT",
    llmCategory: "Meals",
    isDeductible: false,
    llmReasoning: "No clear business purpose captured in description.",
  },
  {
    id: "tx_5507ab0d",
    date: "2026-02-07",
    institution: "Coinbase",
    description: "Cloud Storage Annual Plan",
    amount: "119.00",
    transactionType: "DEBIT",
    llmCategory: "Hosting & Storage",
    isDeductible: true,
    llmReasoning: "Storage used to deliver client media and backups.",
  },
] as const;

const sampleCategoryTotals = [
  { category: "Travel", total: "$286.40", deductible: "$286.40", nonDeductible: "$0.00", count: 1 },
  { category: "Software & SaaS", total: "$15.00", deductible: "$15.00", nonDeductible: "$0.00", count: 1 },
  { category: "Hosting & Storage", total: "$119.00", deductible: "$119.00", nonDeductible: "$0.00", count: 1 },
  { category: "Meals", total: "$9.75", deductible: "$0.00", nonDeductible: "$9.75", count: 1 },
] as const;

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const [businessType, setBusinessType] = useState("");
  const [businessProfiles, setBusinessProfiles] = useState<BusinessProfileOption[]>([]);
  const [aggressivenessLevel, setAggressivenessLevel] = useState<(typeof levels)[number]>("MODERATE");
  const [driveFolderUrl, setDriveFolderUrl] = useState("");
  const [analysisNote, setAnalysisNote] = useState("");

  const [ingestionJobId, setIngestionJobId] = useState<string | null>(null);
  const [analysisJobId, setAnalysisJobId] = useState<string | null>(null);
  const [ingestionStatus, setIngestionStatus] = useState<JobStatus | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<JobStatus | null>(null);
  const [analysisCheckoutProcessing, setAnalysisCheckoutProcessing] = useState(false);
  const [downloadingCsv, setDownloadingCsv] = useState(false);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [summaryRows, setSummaryRows] = useState<TransactionSummaryRow[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatSending, setChatSending] = useState(false);
  const [chatInitialized, setChatInitialized] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatEligibility, setChatEligibility] = useState<TransactionChatEligibility | null>(null);
  const [chatMessages, setChatMessages] = useState<TransactionChatMessage[]>([]);
  const { toasts, notify, dismissToast } = useToastController();
  const lastIngestionState = useRef<JobStatus["state"] | null>(null);
  const lastAnalysisState = useRef<JobStatus["state"] | null>(null);
  const ANALYSIS_SAMPLE_LIMIT = 100;

  function getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) return error.message;
    return "An unexpected error occurred. Please try again.";
  }

  function isUnauthorizedError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const message = error.message.toLowerCase();
    return message.includes("401") || message.includes("unauthorized");
  }

  function handleUnauthorized(error: unknown): boolean {
    if (!isUnauthorizedError(error)) return false;
    if (!needsReauth) {
      notify({
        key: "reauth-needed",
        kind: "error",
        title: "Google authorization expired",
        message: "Re-authenticate to link Google Drive and continue refreshing job status.",
        persistent: true,
      });
    }
    setNeedsReauth(true);
    dismissToast("ingestion-progress");
    dismissToast("analysis-progress");
    return true;
  }

  function notifyError(title: string, error: unknown, key?: string): void {
    notify({
      key,
      kind: "error",
      title,
      message: getErrorMessage(error),
      durationMs: 5000,
    });
  }

  function initializeAnalysisJob(started: { jobId: string; refreshed: boolean; clearedClassifications: number }): void {
    if (started.refreshed) {
      notify({
        kind: "info",
        title: "Refreshing AI analysis",
        message: `Cleared ${started.clearedClassifications} previous classifications before rerun.`,
        durationMs: 4500,
      });
    }
    setAnalysisJobId(started.jobId);
    setAnalysisStatus({ jobId: started.jobId, state: "queued", processed: 0, total: 0, error: null });
    setTransactions([]);
    setSummaryRows([]);
    setChatMessages([]);
    lastAnalysisState.current = null;
    notify({
      key: "analysis-progress",
      kind: "info",
      title: "Running analysis",
      message: "Starting batch analysis...",
      persistent: true,
    });
  }

  function formatChatCell(value: unknown): string {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  async function loadTransactionChatData(): Promise<void> {
    setChatLoading(true);
    try {
      const eligibility = await api.transactionChatEligibility();
      setChatEligibility(eligibility);
      setChatInitialized(true);
    } catch (error) {
      setChatError(getErrorMessage(error));
    } finally {
      setChatLoading(false);
    }
  }

  useEffect(() => {
    const load = async () => {
      try {
        const user = await api.me();
        const profiles = await api.businessProfiles();
        setMe(user);
        setBusinessProfiles(profiles.rows);
        const defaultBusinessType = profiles.rows[0]?.key ?? "";
        const hasSavedBusinessType = profiles.rows.some((profile) => profile.key === user.businessType);
        const selectedBusinessType = hasSavedBusinessType && user.businessType ? user.businessType : defaultBusinessType;
        setBusinessType(selectedBusinessType);
        setAggressivenessLevel(user.aggressivenessLevel ?? "MODERATE");

        const [classifiedTx, summary, eligibility] = await Promise.all([
          api.transactions({ status: "classified", limit: ANALYSIS_SAMPLE_LIMIT, offset: 0 }),
          api.transactionsSummary(),
          api.transactionChatEligibility(),
        ]);

        if (classifiedTx.rows.length > 0) {
          setTransactions(classifiedTx.rows);
        }
        setSummaryRows(summary.rows);
        setChatEligibility(eligibility);
      } catch (e) {
        setMe(null);
        if (!isUnauthorizedError(e)) {
          notifyError("Failed to load app data", e, "initial-load-error");
        }
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [notify]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkoutSessionId = params.get("checkout_session_id");
    const cancelled = params.get("checkout_cancelled") === "1";
    if (!checkoutSessionId && !cancelled) return;

    const clearQueryParams = () => {
      window.history.replaceState({}, "", window.location.pathname);
    };

    if (cancelled) {
      notify({
        kind: "info",
        title: "Checkout cancelled",
        message: "No charge was made. You can retry when ready.",
        durationMs: 3500,
      });
      clearQueryParams();
      return;
    }

    let active = true;
    const finalize = async () => {
      setAnalysisCheckoutProcessing(true);
      try {
        notify({
          key: "analysis-progress",
          kind: "info",
          title: "Verifying payment",
          message: "Confirming checkout before analysis starts...",
          persistent: true,
        });
        const verified = await api.verifyAnalysisCheckout(checkoutSessionId!);
        if (!verified.success) {
          throw new Error("Checkout has not been paid yet.");
        }
        const started = await api.finalizeAnalysisCheckout(checkoutSessionId!);
        if (!active) return;
        initializeAnalysisJob(started);
      } catch (error) {
        dismissToast("analysis-progress");
        notifyError("Payment verification failed", error);
      } finally {
        if (active) {
          setAnalysisCheckoutProcessing(false);
          clearQueryParams();
        }
      }
    };

    void finalize();
    return () => {
      active = false;
    };
  }, [dismissToast, notify]);

  useEffect(() => {
    if (!ingestionJobId || needsReauth) return;
    const timer = setInterval(async () => {
      try {
        const status = await api.ingestionStatus(ingestionJobId);
        setIngestionStatus(status);
      } catch (e) {
        if (handleUnauthorized(e)) return;
        notifyError("Could not refresh data cleaning status", e, "ingestion-status-error");
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [dismissToast, ingestionJobId, needsReauth, notify]);

  useEffect(() => {
    if (!analysisJobId || needsReauth) return;
    const timer = setInterval(async () => {
      try {
        const status = await api.analysisStatus(analysisJobId);
        setAnalysisStatus(status);
        if (status.state === "queued" || status.state === "running" || status.state === "completed") {
          const [tx, eligibility] = await Promise.all([
            api.transactions({ status: "classified", limit: ANALYSIS_SAMPLE_LIMIT, offset: 0 }),
            api.transactionChatEligibility(),
          ]);
          setTransactions(tx.rows);
          setChatEligibility(eligibility);
        }
        if (status.state === "completed") {
          const summary = await api.transactionsSummary();
          setSummaryRows(summary.rows);
        }
      } catch (e) {
        if (handleUnauthorized(e)) return;
        notifyError("Could not refresh analysis status", e, "analysis-status-error");
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [analysisJobId, dismissToast, needsReauth, notify]);

  useEffect(() => {
    if (!ingestionStatus) return;
    if (ingestionStatus.processed < 1) return;
    const loadTransactions = async () => {
      try {
        const [tx, eligibility] = await Promise.all([api.transactions(), api.transactionChatEligibility()]);
        setTransactions(tx.rows);
        setChatEligibility(eligibility);
      } catch (e) {
        if (handleUnauthorized(e)) return;
        notifyError("Could not load transactions", e, "transactions-load-error");
      }
    };
    void loadTransactions();
  }, [dismissToast, ingestionStatus?.processed, ingestionStatus?.state, needsReauth, notify]);

  useEffect(() => {
    if (!ingestionStatus) return;

    const message = ingestionStatus.total > 0 ? `${ingestionStatus.processed}/${ingestionStatus.total} files` : "Preparing files";
    if (ingestionStatus.state === "queued" || ingestionStatus.state === "running") {
      notify({
        key: "ingestion-progress",
        kind: "info",
        title: "Processing files",
        message,
        persistent: true,
      });
    }

    if (ingestionStatus.state === "completed" && lastIngestionState.current !== "completed") {
      dismissToast("ingestion-progress");
      if (ingestionStatus.total === 0) {
        notify({
          kind: "warning",
          title: "No records to process",
          message: `[ingestion:${ingestionStatus.jobId}] Found 0 supported files`,
          durationMs: 5000,
        });
        lastIngestionState.current = ingestionStatus.state;
        return;
      }
      notify({
        kind: "success",
        title: "Data cleaning completed",
        durationMs: 2500,
      });
    }

    if (ingestionStatus.state === "failed" && lastIngestionState.current !== "failed") {
      dismissToast("ingestion-progress");
      notify({
        kind: "error",
        title: "Data cleaning failed",
        message: ingestionStatus.error ?? "An unknown error occurred.",
        durationMs: 5000,
      });
    }

    lastIngestionState.current = ingestionStatus.state;
  }, [dismissToast, ingestionStatus, notify]);

  useEffect(() => {
    if (!analysisStatus) return;

    if (analysisStatus.state === "queued" || analysisStatus.state === "running") {
      const message = analysisStatus.total > 0 ? `${analysisStatus.processed}/${analysisStatus.total} transactions` : "Preparing analysis";
      notify({
        key: "analysis-progress",
        kind: "info",
        title: "Running analysis",
        message,
        persistent: true,
      });
    }

    if (analysisStatus.state === "completed" && lastAnalysisState.current !== "completed") {
      dismissToast("analysis-progress");
      notify({
        kind: "success",
        title: "Analysis completed",
        durationMs: 2500,
      });
    }

    if (analysisStatus.state === "failed" && lastAnalysisState.current !== "failed") {
      dismissToast("analysis-progress");
      notify({
        kind: "error",
        title: "Analysis failed",
        message: "Analysis failed due to a temporary model issue. Please try again.",
        durationMs: 5000,
      });
    }

    lastAnalysisState.current = analysisStatus.state;
  }, [analysisStatus, dismissToast, notify]);

  const availableBusinessTypeKeys = useMemo(() => new Set(businessProfiles.map((profile) => profile.key)), [businessProfiles]);
  const profileComplete = useMemo(
    () => businessType.length > 0 && availableBusinessTypeKeys.has(businessType) && Boolean(aggressivenessLevel),
    [availableBusinessTypeKeys, businessType, aggressivenessLevel],
  );

  if (loading) return <main className="app-shell">Loading...</main>;

  if (!me) {
    return (
      <main className="auth-shell">
        <section className="hero-card marketing-hero">
          <p className="eyebrow">AI Expense Review</p>
          <h1>Before Your Advisor</h1>
          <p className="hero-subtitle">
            Upload statements, review AI categorization, and send cleaner records to your tax professional.
          </p>
          <div className="hero-actions">
            <a className="button" href={api.authUrl}>
              Log in with Google to start
            </a>
            <p className="muted hero-footnote">Secure sign-in. One Drive folder connection to begin.</p>
          </div>
          <div className="hero-stats">
            <article className="hero-stat">
              <strong>3-step flow</strong>
              <span>Link data, set profile, run analysis</span>
            </article>
            <article className="hero-stat">
              <strong>CSV export</strong>
              <span>Share review-ready outputs with your advisor</span>
            </article>
            <article className="hero-stat">
              <strong>Reasoning included</strong>
              <span>Each classification includes an explainable note</span>
            </article>
          </div>
        </section>

        <section className="marketing-grid">
          <article className="panel">
            <h2>How It Works</h2>
            <ol className="workflow-list">
              <li>Connect a Google Drive folder with statement files.</li>
              <li>Pick your business profile and risk level.</li>
              <li>Run analysis, review classifications, and download CSV.</li>
            </ol>
          </article>

          <article className="panel">
            <h2>What You Get</h2>
            <ul className="clean-list">
              <li>Role-aware deduction suggestions tuned to your business type.</li>
              <li>Clear breakdown by deductible vs non-deductible totals.</li>
              <li>Built-in transaction chat for quick questions during review.</li>
            </ul>
          </article>

          <article className="panel panel-full">
            <div className="panel-header">
              <h2>Sample Review Snapshot</h2>
              <span className="sample-pill">4 transactions</span>
            </div>
            <p className="muted">Example output after a complete run.</p>
            <div className="snapshot-grid">
              <div>
                <h3 className="snapshot-heading">Latest Classifications</h3>
                <ul className="snapshot-list">
                  {sampleTransactions.map((tx) => (
                    <li key={tx.id}>
                      <span>{tx.description}</span>
                      <span className={`result-badge ${tx.isDeductible ? "yes" : "no"}`}>
                        {tx.isDeductible ? "Likely deductible" : "Needs review"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="snapshot-heading">Category Totals</h3>
                <ul className="snapshot-list">
                  {sampleCategoryTotals.map((row) => (
                    <li key={row.category}>
                      <span>{row.category}</span>
                      <span>{row.deductible} / {row.total}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </article>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Signed in as {me.email}</p>
          <h1>Before Your Advisor Workspace</h1>
        </div>
        <div className="hero-actions">
          {needsReauth ? (
            <a className="button" href={api.authUrl}>
              Re-authenticate
            </a>
          ) : null}
          <button
            className="button secondary"
            onClick={async () => {
              try {
                await api.logout();
                window.location.href = "/";
              } catch (e) {
                notifyError("Logout failed", e);
              }
            }}
          >
            Logout
          </button>
        </div>
      </header>

      <section className="workflow-steps">
        <article className="panel">
          <h2>1. Link Data (Google Drive)</h2>
          <p className="muted">Paste a Drive folder URL containing Chase/Amex CSV files and Coinbase PDF statements.</p>
          <label>
            Drive Folder URL
            <input value={driveFolderUrl} onChange={(e) => setDriveFolderUrl(e.target.value)} placeholder="https://drive.google.com/drive/folders/..." />
          </label>
          <button
            className="button workflow-action"
            disabled={!driveFolderUrl.trim()}
            onClick={async () => {
              try {
                const started = await api.startIngestion(driveFolderUrl.trim());
                if (started.refreshed) {
                  notify({
                    kind: "info",
                    title: "Refreshing imported data",
                    message: `Cleared ${started.deletedTransactions} existing transactions before re-import.`,
                    durationMs: 4500,
                  });
                }
                setIngestionJobId(started.jobId);
                setIngestionStatus({ jobId: started.jobId, state: "queued", processed: 0, total: 0, error: null });
                setAnalysisJobId(null);
                setAnalysisStatus(null);
                setTransactions([]);
                setSummaryRows([]);
                setChatEligibility(null);
                setChatMessages([]);
                setChatOpen(false);
                lastIngestionState.current = null;
              } catch (e) {
                notifyError("Data cleaning failed to start", e);
              }
            }}
          >
            Start Data Cleaning
          </button>
        </article>

        <article className="panel">
          <h2>2. Business Profile</h2>
          <label>
            Business Role
            <select value={businessType} onChange={(e) => setBusinessType(e.target.value)} disabled={businessProfiles.length === 0}>
              {businessProfiles.length === 0 ? (
                <option value="">No business profiles available</option>
              ) : (
                businessProfiles.map((profile) => (
                  <option key={profile.key} value={profile.key}>
                    {profile.displayName}
                  </option>
                ))
              )}
            </select>
          </label>
          <label>
            Aggressiveness Level
            <select value={aggressivenessLevel} onChange={(e) => setAggressivenessLevel(e.target.value as (typeof levels)[number])}>
              {levels.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button workflow-action"
            disabled={!profileComplete}
            onClick={async () => {
              try {
                await api.updateProfile({ businessType, aggressivenessLevel });
                notify({
                  kind: "success",
                  title: "Profile saved",
                  durationMs: 2200,
                });
              } catch (e) {
                notifyError("Failed to save profile", e);
              }
            }}
          >
            Save Profile
          </button>
        </article>

        <article className="panel">
          <h2>3. Run AI Analysis</h2>
          <p className="muted">Classify unprocessed transactions and mark likely tax deductions.</p>
          <label>
            Optional focus note
            <textarea
              value={analysisNote}
              onChange={(e) => setAnalysisNote(e.target.value)}
              placeholder="flag utilities and client meals for closer review"
            />
          </label>
          <button
            className="button workflow-action"
            disabled={!profileComplete || analysisCheckoutProcessing}
            onClick={async () => {
              try {
                setAnalysisCheckoutProcessing(true);
                const checkout = await api.startAnalysisCheckout({
                  ingestionJobId: ingestionJobId ?? undefined,
                  analysisNote,
                });
                window.location.href = checkout.checkoutUrl;
              } catch (e) {
                setAnalysisCheckoutProcessing(false);
                notifyError("Analysis failed to start", e);
              }
            }}
          >
            {analysisCheckoutProcessing ? "Redirecting to Checkout..." : "Run AI Analysis"}
          </button>
        </article>
      </section>

      <section className="section-spacer">
        <article className="panel panel-full">
          <div className="panel-header">
            <h2>Data Agent Chat</h2>
            <div className="chat-header-actions">
              <button
                className="button secondary"
                disabled={chatLoading}
                onClick={() => {
                  const next = !chatOpen;
                  setChatOpen(next);
                  if (next && !chatInitialized) {
                    void loadTransactionChatData();
                  }
                }}
              >
                {chatOpen ? "Hide Chat" : "Open Chat"}
              </button>
              <button
                className="button secondary"
                disabled={chatLoading || chatSending || !chatOpen}
                onClick={async () => {
                  try {
                    setChatLoading(true);
                    await api.clearTransactionChatHistory();
                    setChatMessages([]);
                    setChatInput("");
                    setChatError(null);
                    setChatInitialized(true);
                    notify({
                      kind: "success",
                      title: "Chat reset",
                      durationMs: 2200,
                    });
                  } catch (error) {
                    setChatError(getErrorMessage(error));
                  } finally {
                    setChatLoading(false);
                  }
                }}
              >
                Start New Chat
              </button>
            </div>
          </div>
          <p className="muted">
            Ask natural language questions about your transaction data. Requires at least 2 transaction rows.
          </p>
          {chatEligibility ? (
            <p className="muted chat-eligibility-line">
              Eligible: {chatEligibility.eligible ? "Yes" : "No"} ({chatEligibility.transactionCount} rows)
            </p>
          ) : null}
          {chatError ? <div className="error-banner">{chatError}</div> : null}
          {chatOpen ? (
            <div className="chat-shell">
              <div className="chat-messages">
                {chatMessages.length === 0 ? <p className="muted">No messages yet.</p> : null}
                {chatMessages.map((message) => (
                  <article key={message.id} className={`chat-message ${message.role === "user" ? "user" : "assistant"}`}>
                    <p className="chat-role">{message.role === "user" ? "You" : "Data Agent"}</p>
                    <p>{message.content}</p>
                    {message.resultTable ? (
                      <div className="table chat-result-table">
                        {message.resultTable.rows.length > 0 ? (
                          <table className="summary-table">
                            <thead>
                              <tr>
                                {message.resultTable.columns.map((column) => (
                                  <th key={column}>{column}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {message.resultTable.rows.map((row, rowIndex) => (
                                <tr key={`${message.id}-${rowIndex}`}>
                                  {message.resultTable?.columns.map((column) => (
                                    <td key={`${message.id}-${rowIndex}-${column}`}>{formatChatCell(row[column])}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <p className="muted">Query returned 0 rows.</p>
                        )}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
              <form
                className="chat-composer"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const trimmed = chatInput.trim();
                  if (!trimmed || chatSending || chatLoading) return;
                  if (!chatEligibility?.eligible) {
                    setChatError("At least 2 transaction rows are required before using chat.");
                    return;
                  }

                  const optimisticMessage: TransactionChatMessage = {
                    id: `temp-${Date.now()}`,
                    role: "user",
                    content: trimmed,
                    sql: null,
                    resultTable: null,
                    createdAt: new Date().toISOString(),
                  };

                  setChatMessages((previous) => [...previous, optimisticMessage]);
                  setChatInput("");
                  setChatError(null);
                  setChatSending(true);
                  try {
                    const response = await api.sendTransactionChatMessage(trimmed);
                    setChatMessages((previous) => [...previous, response.row]);
                  } catch (error) {
                    setChatError(getErrorMessage(error));
                  } finally {
                    setChatSending(false);
                  }
                }}
              >
                <input
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  placeholder="e.g. show my top 10 deductible categories this year"
                  disabled={chatSending || chatLoading || !chatEligibility?.eligible}
                />
                <button
                  className="button"
                  type="submit"
                  disabled={chatSending || chatLoading || !chatEligibility?.eligible || chatInput.trim().length === 0}
                >
                  {chatSending ? "Running..." : "Send"}
                </button>
              </form>
            </div>
          ) : null}
        </article>
      </section>

      <section className="section-spacer">
        <article className="panel panel-full">
          <div className="panel-header">
            <h2>Transactions</h2>
            <button
              className="button secondary"
              disabled={downloadingCsv}
              onClick={async () => {
                try {
                  setDownloadingCsv(true);
                  const blob = await api.downloadTransactionsCsv();
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement("a");
                  const dateStamp = new Date().toISOString().slice(0, 10);
                  link.href = url;
                  link.download = `transactions-${dateStamp}.csv`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  URL.revokeObjectURL(url);
                } catch (e) {
                  notifyError("Failed to download CSV", e);
                } finally {
                  setDownloadingCsv(false);
                }
              }}
            >
              {downloadingCsv ? "Downloading..." : "Download CSV"}
            </button>
          </div>
          <p className="muted">Parsed and classified rows (during analysis, shows up to 100 classified rows live)</p>
          <div className="table">
            {transactions.length ? (
              <table className="transactions-table">
                <thead>
                  <tr>
                    <th className="tx-id-col">Transaction ID</th>
                    <th>Date</th>
                    <th>Institution</th>
                    <th>Description</th>
                    <th>Amount</th>
                    <th>Type</th>
                    <th>Category</th>
                    <th>Deductible</th>
                    <th>LLM Reasoning</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => (
                    <tr key={tx.id}>
                      <td className="tx-id-cell" title={tx.id}>{tx.id}</td>
                      <td>{tx.date}</td>
                      <td>{tx.institution}</td>
                      <td>{tx.description}</td>
                      <td>${Number.parseFloat(tx.amount).toFixed(2)}</td>
                      <td>{tx.transactionType}</td>
                      <td>{tx.llmCategory ?? "Unclassified"}</td>
                      <td>{tx.isDeductible == null ? "-" : tx.isDeductible ? "Yes" : "No"}</td>
                      <td>{tx.llmReasoning ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">No transactions loaded yet.</p>
            )}
          </div>
        </article>
      </section>
      {summaryRows.length > 0 ? (
        <section className="section-spacer">
          <article className="panel panel-full">
            <h2>Category Totals</h2>
            <p className="muted">LLM aggregate totals by category, split by deductible vs non-deductible.</p>
            <div className="table">
              <table className="summary-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Total</th>
                    <th>Deductible</th>
                    <th>Not Deductible</th>
                    <th>Transaction Count</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryRows.map((row) => (
                    <tr key={row.category}>
                      <td>{row.category}</td>
                      <td>${Number.parseFloat(row.totalAmount).toFixed(2)}</td>
                      <td>${Number.parseFloat(row.deductibleAmount).toFixed(2)}</td>
                      <td>${Number.parseFloat(row.nonDeductibleAmount).toFixed(2)}</td>
                      <td>{row.totalCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      ) : null}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}
