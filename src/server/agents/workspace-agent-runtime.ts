import {
  stepCountIs,
  tool,
  ToolLoopAgent,
  type LanguageModel,
} from "ai";
import { z } from "zod";

import type { AnalysisRepository } from "@/features/analysis/server/analysis-repository";
import {
  moduleTypes,
  type AnalysisSnapshot,
  type ReportModuleType,
} from "@/features/analysis/domain/contracts";
import type { WorkspaceToolArtifact } from "@/features/analysis/domain/workspace";
import { promptForRun, workspaceAgentInstructions } from "./workspace-agent-prompts";
import {
  workspaceToolNames,
  type AgentToolContext,
  type WorkspaceToolExecutor,
  type WorkspaceToolName,
} from "./workspace-tool-executor";

export type WorkspaceAgentRunInput = {
  workspaceId: string;
  agentRunId: string;
  signal: AbortSignal;
};

export type WorkspaceAgentRunResult = {
  status: "completed" | "interrupted";
};

export type WorkspaceAgentContextRepository = Pick<
  AnalysisRepository,
  | "getJobForExecution"
  | "getOwnedSnapshot"
  | "listPersistedAgentToolArtifacts"
  | "listCompletedWorkspaceToolNames"
>;

export type WorkspaceAgentToolExecutor = Pick<WorkspaceToolExecutor, "execute">;

type WorkspaceAgentContext = AgentToolContext & {
  kind: "baseline" | "challenge";
  completedTools: WorkspaceToolName[];
};

const emptyInputSchema = z.object({}).strict();
const workspaceToolNameSet = new Set<string>(workspaceToolNames);
const baselineModuleTools = [
  { toolName: "analyze_argument", moduleType: "argument" },
  { toolName: "research_sources", moduleType: "sources" },
  { toolName: "map_perspectives", moduleType: "perspectives" },
  { toolName: "review_risks", moduleType: "risks" },
] as const;
const baselineToolDefinitions = [
  ["analyze_argument", "核对素材中的主张与论证结构。"],
  ["research_sources", "查找并核验报告所需的外部信源。"],
  ["map_perspectives", "整理支持、反对和利益相关方视角。"],
  ["review_risks", "审查素材中的推理风险。"],
  ["synthesize_report", "把已完成的专家结果综合为报告草稿。"],
  ["review_draft", "对综合草稿进行独立二次审校。"],
  ["revise_report", "把已保存的审校要求应用到报告。"],
  ["publish_report", "检查报告是否满足发布条件。"],
] as const;

export class WorkspaceAgentRuntime {
  constructor(
    private readonly model: LanguageModel,
    private readonly executor: WorkspaceAgentToolExecutor,
    private readonly repository: WorkspaceAgentContextRepository,
  ) {}

  async run(input: WorkspaceAgentRunInput): Promise<WorkspaceAgentRunResult> {
    try {
      const context = await loadWorkspaceAgentContext(this.repository, input);
      const agent = new ToolLoopAgent({
        model: this.model,
        instructions: workspaceAgentInstructions,
        tools: createAiSdkTools(this.executor, context),
        stopWhen: stepCountIs(16),
      });
      await agent.generate({
        prompt: promptForRun(context),
        abortSignal: input.signal,
      });
      if (context.kind === "challenge") {
        await assertChallengeRunCompleted(this.repository, input, context.messageId);
      } else {
        await assertBaselineRunCompleted(this.repository, input);
      }
      return { status: input.signal.aborted ? "interrupted" : "completed" };
    } catch (error) {
      if (input.signal.aborted) return { status: "interrupted" };
      throw error;
    }
  }
}

export async function loadWorkspaceAgentContext(
  repository: WorkspaceAgentContextRepository,
  input: WorkspaceAgentRunInput,
): Promise<WorkspaceAgentContext> {
  const job = await repository.getJobForExecution(input.workspaceId);
  if (!job) throw new Error("WORKSPACE_NOT_FOUND");
  const snapshot = await repository.getOwnedSnapshot(job.userId, input.workspaceId);
  const run = snapshot?.activeRun;
  if (
    !snapshot
    || run?.id !== input.agentRunId
    || run.status !== "running"
    || run.cancellationRequestedAt !== null
  ) {
    throw new Error("AGENT_RUN_UNAVAILABLE");
  }

  const completedToolNames = new Set((
    await repository.listCompletedWorkspaceToolNames({
      workspaceId: input.workspaceId,
      userId: job.userId,
    })
  ).filter(isWorkspaceToolName));
  const completedTools = run.kind === "baseline"
    ? await resolveCompletedBaselineTools(repository, job.userId, snapshot, completedToolNames)
    : completedToolNames;
  const pendingMessage = run.kind === "challenge"
    ? snapshot.messages.find((message) =>
        message.id === run.messageId
        && message.role === "user"
        && (message.status === "queued" || message.status === "recoverable")
      )
    : undefined;
  if (run.kind === "challenge" && !pendingMessage) {
    throw new Error("AGENT_RUN_UNAVAILABLE");
  }
  return {
    workspaceId: input.workspaceId,
    agentRunId: input.agentRunId,
    signal: input.signal,
    kind: run.kind,
    completedTools: [...completedTools],
    ...(pendingMessage
      ? { messageId: pendingMessage.id, target: pendingMessage.target }
      : {}),
  };
}

async function resolveCompletedBaselineTools(
  repository: WorkspaceAgentContextRepository,
  userId: string,
  snapshot: AnalysisSnapshot,
  completedToolNames: ReadonlySet<WorkspaceToolName>,
): Promise<Set<WorkspaceToolName>> {
  const completedTools = new Set<WorkspaceToolName>();
  for (const { toolName, moduleType } of baselineModuleTools) {
    if (snapshot.modules[moduleType].status === "completed") completedTools.add(toolName);
  }

  const [synthesisArtifacts, reviewArtifacts, revisionArtifacts] = await Promise.all([
    repository.listPersistedAgentToolArtifacts({
      workspaceId: snapshot.workspaceId,
      userId,
      toolName: "synthesize_report",
    }),
    repository.listPersistedAgentToolArtifacts({
      workspaceId: snapshot.workspaceId,
      userId,
      toolName: "review_draft",
    }),
    repository.listPersistedAgentToolArtifacts({
      workspaceId: snapshot.workspaceId,
      userId,
      toolName: "revise_report",
    }),
  ]);
  const syntheses = synthesisArtifacts.filter(isSynthesisArtifact);
  const reviews = reviewArtifacts.filter(isDraftReviewArtifact);
  const revisions = revisionArtifacts.filter(isRevisionArtifact);
  const currentVersions = snapshotModuleVersions(snapshot);
  const synthesisMatches = (versions: Record<ReportModuleType, number>) =>
    syntheses.some((artifact) => sameVersionMaps(artifact.outputVersions, versions));
  const reviewMatches = (versions: Record<ReportModuleType, number>) =>
    reviews.some((artifact) =>
      sameVersionMaps(artifact.inputVersions, versions)
      && synthesisMatches(artifact.inputVersions)
    );
  const revisionMatches = revisions.some((revision) =>
    sameVersionMaps(revision.outputVersions, currentVersions)
    && reviews.some((review) =>
      sameVersionMaps(review.inputVersions, revision.inputVersions)
      && synthesisMatches(review.inputVersions)
    )
  );

  if (revisionMatches) {
    completedTools.add("synthesize_report");
    completedTools.add("review_draft");
    completedTools.add("revise_report");
    if (completedToolNames.has("publish_report")) completedTools.add("publish_report");
  } else if (reviewMatches(currentVersions)) {
    completedTools.add("synthesize_report");
    completedTools.add("review_draft");
  } else if (synthesisMatches(currentVersions)) {
    completedTools.add("synthesize_report");
  }
  return completedTools;
}

function snapshotModuleVersions(snapshot: AnalysisSnapshot): Record<ReportModuleType, number> {
  return Object.fromEntries(
    moduleTypes.map((moduleType) => [moduleType, snapshot.modules[moduleType].version]),
  ) as Record<ReportModuleType, number>;
}

function sameVersionMaps(
  left: Record<ReportModuleType, number>,
  right: Record<ReportModuleType, number>,
): boolean {
  return moduleTypes.every((moduleType) => left[moduleType] === right[moduleType]);
}

function isSynthesisArtifact(
  artifact: WorkspaceToolArtifact,
): artifact is Extract<WorkspaceToolArtifact, { kind: "synthesis" }> {
  return artifact.kind === "synthesis";
}

function isDraftReviewArtifact(
  artifact: WorkspaceToolArtifact,
): artifact is Extract<WorkspaceToolArtifact, { kind: "draft_review" }> {
  return artifact.kind === "draft_review";
}

function isRevisionArtifact(
  artifact: WorkspaceToolArtifact,
): artifact is Extract<WorkspaceToolArtifact, { kind: "revision" }> {
  return artifact.kind === "revision";
}

function createAiSdkTools(
  executor: WorkspaceAgentToolExecutor,
  context: WorkspaceAgentContext,
) {
  const noInputTool = (name: WorkspaceToolName, description: string) =>
    tool({
      description,
      inputSchema: emptyInputSchema,
      execute: async () => executor.execute(name, context),
    });

  return context.kind === "challenge" ? {
    review_target: noInputTool("review_target", "复核当前工作空间中用户质疑的既有报告条目。"),
  } : Object.fromEntries(
    baselineToolDefinitions
      .filter(([name]) => !context.completedTools.includes(name))
      .map(([name, description]) => [name, noInputTool(name, description)]),
  );
}

async function assertBaselineRunCompleted(
  repository: WorkspaceAgentContextRepository,
  input: WorkspaceAgentRunInput,
): Promise<void> {
  const context = await loadWorkspaceAgentContext(repository, input);
  if (
    context.kind !== "baseline"
    || baselineToolDefinitions.some(([name]) => !context.completedTools.includes(name))
  ) {
    throw new Error("BASELINE_INCOMPLETE");
  }
}

export async function assertChallengeRunCompleted(
  repository: WorkspaceAgentContextRepository,
  input: WorkspaceAgentRunInput,
  messageId?: string,
): Promise<void> {
  const job = await repository.getJobForExecution(input.workspaceId);
  const snapshot = job
    ? await repository.getOwnedSnapshot(job.userId, input.workspaceId)
    : null;
  const reviewed = snapshot?.toolCalls.some((call) =>
    call.agentRunId === input.agentRunId
    && call.toolName === "review_target"
    && call.status === "completed"
  );
  const messageCompleted = snapshot?.messages.some((message) =>
    message.id === messageId
    && message.role === "user"
    && message.status === "completed"
  );
  if (!reviewed || !messageCompleted) throw new Error("CHALLENGE_INCOMPLETE");
}

function isWorkspaceToolName(name: string): name is WorkspaceToolName {
  return workspaceToolNameSet.has(name);
}
