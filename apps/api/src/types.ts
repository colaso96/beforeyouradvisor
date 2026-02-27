export type SessionUser = {
  id: string;
  email: string;
  accessToken?: string;
};

export type JobState = "queued" | "running" | "completed" | "failed";
