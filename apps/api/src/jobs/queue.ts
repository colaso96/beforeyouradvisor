import { runAnalysisJob } from "./analysisWorker.js";
import { runIngestionJob } from "../services/ingestionService.js";

type JobFn = () => Promise<void>;

const queue: JobFn[] = [];
let active = false;

async function consume(): Promise<void> {
  if (active) return;
  active = true;

  while (queue.length > 0) {
    const fn = queue.shift();
    if (fn) {
      await fn();
    }
  }

  active = false;
}

export function enqueueIngestion(args: { jobId: string; userId: string; accessToken: string; folderId: string }): void {
  queue.push(() => runIngestionJob(args.jobId, args.userId, args.accessToken, args.folderId));
  void consume();
}

export function enqueueAnalysis(args: { jobId: string; userId: string; analysisNote?: string }): void {
  queue.push(() => runAnalysisJob(args.jobId, args.userId, args.analysisNote));
  void consume();
}
