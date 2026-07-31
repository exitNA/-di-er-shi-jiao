import type {
  AnalysisSnapshot,
  AnalysisJobStatus,
  BaselineDraft,
  ExternalSource,
  ReportModuleStatus,
  ReportModuleType,
} from "@/features/analysis/domain/contracts";

export type NewAnalysis = {
  jobId: string;
  materialId: string;
  reportId: string;
  userId: string;
  content: string;
  detectedLanguage: "zh" | "en" | "mixed";
  idempotencyKey: string;
  configVersion: string;
  now: Date;
};

export type ExecutionJob = {
  jobId: string;
  userId: string;
  reportId: string;
  material: string;
  detectedLanguage: "zh" | "en" | "mixed";
  status: AnalysisJobStatus;
  configVersion: string;
};

export type HistoryItem = {
  jobId: string;
  status: AnalysisJobStatus;
  materialPreview: string;
  createdAt: string;
  completedModuleCount: number;
};

export type JobTransitionFields = {
  triggerRunId?: string | null;
  failureCode?: string | null;
  now?: Date;
};

export type SaveModule = {
  jobId: string;
  reportId: string;
  userId: string;
  moduleType: ReportModuleType;
  status: ReportModuleStatus;
  payload?: BaselineDraft[ReportModuleType];
  errorCode?: string;
  expectedVersion: number;
  nextVersion: number;
  now: Date;
};

export type StartExpertRun = {
  id: string;
  jobId: string;
  expertType: "argument" | "sources" | "perspectives" | "risks" | "synthesis";
  phase: "baseline" | "second-review" | "revision";
  attempt: number;
  configVersion: string;
  now: Date;
};

export type FinishExpertRun = {
  id: string;
  status: "completed" | "failed";
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: string;
  latencyMs: number;
  errorCode?: string;
  now: Date;
};

export type NewAnalysisEvent = {
  jobId: string;
  userId: string;
  eventType:
    | "job.started"
    | "module.updated"
    | "job.recoverable"
    | "baseline.completed"
    | "report.degraded";
  payload: Record<string, string | number | boolean | null>;
  now: Date;
};

export type AnalysisEvent = Omit<NewAnalysisEvent, "now"> & {
  id: number;
  createdAt: string;
};

export interface AnalysisRepository {
  createAnalysis(input: NewAnalysis): Promise<{ jobId: string; created: boolean }>;
  getJobForExecution(jobId: string): Promise<ExecutionJob | null>;
  getOwnedSnapshot(userId: string, jobId: string): Promise<AnalysisSnapshot | null>;
  listOwnedHistory(userId: string, limit: number, before?: Date): Promise<HistoryItem[]>;
  transitionJob(
    jobId: string,
    from: AnalysisJobStatus[],
    to: AnalysisJobStatus,
    fields?: JobTransitionFields,
  ): Promise<boolean>;
  startExpertRun(input: StartExpertRun): Promise<string>;
  finishExpertRun(input: FinishExpertRun): Promise<void>;
  saveModule(input: SaveModule): Promise<void>;
  replaceSources(reportId: string, sources: ExternalSource[]): Promise<void>;
  appendEvent(input: NewAnalysisEvent): Promise<number>;
  listEvents(userId: string, jobId: string, afterId: number, limit: number): Promise<AnalysisEvent[]>;
}
