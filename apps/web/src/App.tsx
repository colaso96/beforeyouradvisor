import { useEffect, useMemo, useRef, useState } from "react";
import { api, type BusinessProfileOption, type JobStatus, type Me, type TransactionRow, type TransactionSummaryRow } from "./api/client";
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
  const [downloadingCsv, setDownloadingCsv] = useState(false);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [summaryRows, setSummaryRows] = useState<TransactionSummaryRow[]>([]);
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

        const [classifiedTx, summary] = await Promise.all([
          api.transactions({ status: "classified", limit: ANALYSIS_SAMPLE_LIMIT, offset: 0 }),
          api.transactionsSummary(),
        ]);

        if (classifiedTx.rows.length > 0) {
          setTransactions(classifiedTx.rows);
        }
        setSummaryRows(summary.rows);
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
          const tx = await api.transactions({ status: "classified", limit: ANALYSIS_SAMPLE_LIMIT, offset: 0 });
          setTransactions(tx.rows);
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
        const tx = await api.transactions();
        setTransactions(tx.rows);
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
          <h1>
            Writeoffs GPT
          </h1>
          {/* <h2>
            Maximize your year-end tax savings with AI powered expense categorization
          </h2> */}
          <div className="hero-actions">
            <a className="button" href={api.authUrl}>
              Log in with Google to start
            </a>
          </div>

          <footer className="hero-footer">
            <p className="muted">
              Upload statements to receive AI-driven deduction suggestions by category and run a full analysis.
            </p>
          </footer>
        </section>

        <section className="marketing-grid">
          <article className="panel panel-full">
            <h2>What You Get</h2>
            <p className="muted">A clean workflow: ingest files, apply role-aware LLM categorization, and export a review-ready CSV.</p>
            <div className="feature-list">
              <p>Role-specific tax deduction detection for common freelance businesses.</p>
              <p>Low-cost automation for transaction cleanup and first-pass categorization.</p>
              <p>Transparent reasoning for each deductible vs non-deductible decision.</p>
            </div>
          </article>

          <article className="panel">
            <h2>Sample Transactions </h2>
            <p className="muted">Preview of the classified transaction table after analysis.</p>
            <div className="table mock-table">
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
                  {sampleTransactions.map((tx) => (
                    <tr key={tx.id}>
                      <td className="tx-id-cell" title={tx.id}>{tx.id}</td>
                      <td>{tx.date}</td>
                      <td>{tx.institution}</td>
                      <td>{tx.description}</td>
                      <td>${Number.parseFloat(tx.amount).toFixed(2)}</td>
                      <td>{tx.transactionType}</td>
                      <td>{tx.llmCategory}</td>
                      <td>{tx.isDeductible ? "Yes" : "No"}</td>
                      <td>{tx.llmReasoning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="panel">
            <h2>Sample Category Totals</h2>
            <p className="muted">Category rollup that highlights likely writeoffs at a glance.</p>
            <div className="table mock-table">
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
                  {sampleCategoryTotals.map((row) => (
                    <tr key={row.category}>
                      <td>{row.category}</td>
                      <td>{row.total}</td>
                      <td>{row.deductible}</td>
                      <td>{row.nonDeductible}</td>
                      <td>{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
          <h1>Writeoffs Workflow</h1>
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
          <p className="muted">Classify unprocessed transactions and mark likely deductions.</p>
          <label>
            Optional focus note
            <textarea
              value={analysisNote}
              onChange={(e) => setAnalysisNote(e.target.value)}
              placeholder="look for utilities and dinner expenses to write off"
            />
          </label>
          <button
            className="button workflow-action"
            disabled={!profileComplete}
            onClick={async () => {
              try {
                const started = await api.startAnalysis({
                  ingestionJobId: ingestionJobId ?? undefined,
                  analysisNote,
                });
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
                lastAnalysisState.current = null;
                notify({
                  key: "analysis-progress",
                  kind: "info",
                  title: "Running analysis",
                  message: "Starting batch analysis...",
                  persistent: true,
                });
              } catch (e) {
                notifyError("Analysis failed to start", e);
              }
            }}
          >
            Run AI Analysis
          </button>
        </article>
      </section>

      <section>
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
