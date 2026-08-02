import type {
  AnalysisSnapshot,
  AnalysisJobStatus,
  BaselineDraft,
  ExternalSource,
  ReportItemTarget,
  ReportRevisionChange,
  ReportModuleStatus,
  ReportModuleType,
} from "@/features/analysis/domain/contracts";
import type {
  AgentRunKind,
  WorkspaceRunStatus,
  WorkspaceToolArtifact,
} from "@/features/analysis/domain/workspace";

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
  agentRunId?: string;
  moduleType: ReportModuleType;
  status: ReportModuleStatus;
  payload?: BaselineDraft[ReportModuleType];
  errorCode?: string;
  expectedVersion: number;
  nextVersion: number;
  now: Date;
};

export type SaveRevisionDraft = {
  jobId: string;
  reportId: string;
  userId: string;
  agentRunId?: string;
  draft: BaselineDraft;
  expectedVersions: Record<ReportModuleType, number>;
  nextVersions: Record<ReportModuleType, number>;
  now: Date;
};

export type NewChallenge = {
  jobId: string;
  reportId: string;
  userId: string;
  target: ReportItemTarget;
  content: string;
  idempotencyKey: string;
  now: Date;
};

export type NewChallengeAgentRun = NewChallenge & {
  configVersion: string;
};

export type ChallengeAgentRunResult = {
  messageId: string;
  agentRunId: string;
  created: boolean;
  status: "queued" | "running" | "recoverable" | "completed";
  shouldEnqueue: boolean;
};

export type RevisionModuleUpdate = {
  [ModuleType in ReportModuleType]: {
    moduleType: ModuleType;
    payload: BaselineDraft[ModuleType];
    expectedVersion: number;
    nextVersion: number;
  };
}[ReportModuleType];

export type CompleteRevision = {
  jobId: string;
  reportId: string;
  userId: string;
  messageId: string;
  leaseId: string;
  agentContent: string;
  expectedReportVersion: number;
  module: RevisionModuleUpdate;
  changes: ReportRevisionChange[];
  toolCall?: CompleteChallengeToolCall;
  now: Date;
};

export type CompleteChallengeToolCall = {
  agentRunId: string;
  id: string;
  summary: string;
};

export type RecoverRevision = {
  jobId: string;
  reportId: string;
  userId: string;
  messageId: string;
  leaseId: string;
  now: Date;
};

export type StartRevision = RecoverRevision & {
  leaseExpiresAt: Date;
};

export type CompleteRevisionResponse = RecoverRevision & {
  agentContent: string;
  expectedReportVersion: number;
  target: ReportItemTarget;
  expectedModuleVersion: number;
  toolCall?: CompleteChallengeToolCall;
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

type AgentRunFields = {
  workspaceId: string;
  userId: string;
  configVersion: string;
  previousAgentRunId?: string;
  now: Date;
};

export type NewAgentRun = AgentRunFields & (
  | { kind: Extract<AgentRunKind, "baseline">; messageId?: never }
  | { kind: Extract<AgentRunKind, "challenge">; messageId: string }
);

export type ClaimAgentRun = {
  workspaceId: string;
  userId: string;
  agentRunId: string;
  triggerRunId?: string;
  now: Date;
};

export type RequestAgentRunCancellation = {
  workspaceId: string;
  userId: string;
  agentRunId: string;
  now: Date;
};

export type FinishAgentRun = {
  workspaceId: string;
  userId: string;
  agentRunId: string;
  status: "completed" | "recoverable";
  now: Date;
};

export type NewAgentToolCall = {
  workspaceId: string;
  userId: string;
  agentRunId: string;
  toolName: string;
  summary: string;
  now: Date;
};

export type AppendAgentToolCallResult =
  | { id: string }
  | { code: "TOOL_CALL_BUDGET_EXCEEDED" }
  | null;

export type FinishAgentToolCall = {
  workspaceId: string;
  userId: string;
  agentRunId: string;
  id: string;
  status: "completed" | "recoverable";
  summary: string;
  errorCode?: string;
  artifact?: WorkspaceToolArtifact;
  now: Date;
};

export type SaveAgentToolArtifact = Pick<
  FinishAgentToolCall,
  "workspaceId" | "userId" | "agentRunId" | "id" | "artifact"
> & { artifact: WorkspaceToolArtifact };

export type FindAgentToolArtifact = {
  workspaceId: string;
  userId: string;
  toolName: string;
};

export type NewAnalysisEvent = {
  jobId: string;
  userId: string;
  eventType:
    | "job.started"
    | "module.updated"
    | "job.recoverable"
    | "baseline.completed"
    | "report.degraded"
    | "conversation.updated"
    | "report.revised"
    | "agent.run.completed"
    | "agent.run.interrupted"
    | "agent.tool.updated"
    | "agent.output.delta"
    | "agent.ui.run.started"
    | "agent.ui.run.finished"
    | "agent.ui.run.error"
    | "agent.ui.step.started"
    | "agent.ui.step.finished"
    | "agent.ui.text.started"
    | "agent.ui.text.delta"
    | "agent.ui.text.finished"
    | "agent.ui.tool.started"
    | "agent.ui.tool.args"
    | "agent.ui.tool.finished"
    | "agent.ui.tool.result"
    | "agent.ui.reasoning.summary"
    | "agent.ui.activity";
  payload: Record<string, unknown>;
  now: Date;
};

export type AnalysisEvent = Omit<NewAnalysisEvent, "now"> & {
  id: number;
  createdAt: string;
};

export interface AnalysisRepository {
  createAnalysis(input: NewAnalysis): Promise<{ jobId: string; created: boolean }>;
  createChallenge(input: NewChallenge): Promise<{ messageId: string; created: boolean } | null>;
  createChallengeAgentRun(
    input: NewChallengeAgentRun,
  ): Promise<ChallengeAgentRunResult | { code: "RUN_BUSY" } | null>;
  findChallengeByIdempotency(
    input: Pick<NewChallenge, "idempotencyKey" | "jobId" | "reportId" | "userId">,
  ): Promise<{ messageId: string } | null>;
  startRevision(input: StartRevision): Promise<boolean>;
  completeRevisionResponse(input: CompleteRevisionResponse): Promise<boolean>;
  completeRevision(input: CompleteRevision): Promise<{ completed: boolean; revisionId?: string }>;
  recoverRevision(input: RecoverRevision): Promise<boolean>;
  getJobForExecution(jobId: string): Promise<ExecutionJob | null>;
  getOwnedSnapshot(userId: string, jobId: string): Promise<AnalysisSnapshot | null>;
  listOwnedHistory(userId: string, limit: number, before?: Date): Promise<HistoryItem[]>;
  transitionJob(
    jobId: string,
    from: AnalysisJobStatus[],
    to: AnalysisJobStatus,
    fields?: JobTransitionFields,
  ): Promise<boolean>;
  createAgentRun(input: NewAgentRun): Promise<{ id: string } | null>;
  claimAgentRun(input: ClaimAgentRun): Promise<boolean>;
  requestAgentRunCancellation(
    input: RequestAgentRunCancellation,
  ): Promise<{ triggerRunId: string | null; eventId: number } | null>;
  finishAgentRun(input: FinishAgentRun): Promise<boolean>;
  appendAgentToolCall(input: NewAgentToolCall): Promise<AppendAgentToolCallResult>;
  saveAgentToolArtifact(input: SaveAgentToolArtifact): Promise<boolean>;
  finishAgentToolCall(input: FinishAgentToolCall): Promise<boolean>;
  findCompletedAgentToolArtifact(input: FindAgentToolArtifact): Promise<WorkspaceToolArtifact | null>;
  listCompletedAgentToolArtifacts(input: FindAgentToolArtifact): Promise<WorkspaceToolArtifact[]>;
  listPersistedAgentToolArtifacts(input: FindAgentToolArtifact): Promise<WorkspaceToolArtifact[]>;
  listCompletedWorkspaceToolNames(input: Pick<FindAgentToolArtifact, "workspaceId" | "userId">): Promise<string[]>;
  startExpertRun(input: StartExpertRun): Promise<string>;
  finishExpertRun(input: FinishExpertRun): Promise<void>;
  saveModule(input: SaveModule): Promise<void>;
  saveSourcesModule(input: SaveModule & { moduleType: "sources"; payload: BaselineDraft["sources"] }): Promise<void>;
  saveRevisionDraft(input: SaveRevisionDraft): Promise<boolean>;
  replaceSources(reportId: string, sources: ExternalSource[]): Promise<void>;
  appendEvent(input: NewAnalysisEvent): Promise<number>;
  listEvents(userId: string, jobId: string, afterId: number, limit: number): Promise<AnalysisEvent[]>;
}
