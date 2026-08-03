import type { AgentRunKind } from "@/features/analysis/domain/workspace";
import type { AnalysisRepository } from "@/features/analysis/server/analysis-repository";
import {
  moduleTypes,
  type AnalysisSnapshot,
  type ReportModuleType,
} from "@/features/analysis/domain/contracts";
import type { WorkspaceToolArtifact } from "@/features/analysis/domain/workspace";
import {
  type ExpertSession,
  type ExpertSessionInput,
  expertResourceDir,
} from "../shared/expert-harness";
import { loadPromptTemplate, systemInstruction } from "../shared/prompt";
import {
  workspaceToolNames,
  type AgentToolContext,
  type WorkspaceToolExecutor,
  type WorkspaceToolName,
} from "../workspace-tool-executor";
import { createDelegateExpertTool } from "./tools/delegate-expert";
import { createReportActionTool } from "./tools/report-actions";
import {
  bridgePiEvent,
  redactPiText,
  type PiEventBridgeContext,
} from "./pi-event-bridge";

export type ManagerAgentRunInput = {
  workspaceId: string;
  agentRunId: string;
  signal: AbortSignal;
};

export type ManagerAgentRunResult = {
  status: "completed" | "interrupted";
};

export type ManagerAgentContextRepository = Pick<
  AnalysisRepository,
  | "getJobForExecution"
  | "getOwnedSnapshot"
  | "listPersistedAgentToolArtifacts"
  | "listCompletedWorkspaceToolNames"
  | "appendEvent"
>;

export type ManagerAgentToolExecutor = Pick<
  WorkspaceToolExecutor,
  "runExpert" | "runReportAction"
>;

export type ManagerAgentSessionInput = ExpertSessionInput;
export type ManagerAgentSessionFactory = (
  input: ManagerAgentSessionInput,
) => Promise<ExpertSession>;

type ManagerAgentContext = AgentToolContext & {
  userId: string;
  kind: "baseline" | "challenge";
  completedTools: WorkspaceToolName[];
};

const managerAgentInstructions = systemInstruction(loadPromptTemplate("manager/prompts/system"));

function promptForRun(input: {
  kind: AgentRunKind;
  completedTools?: readonly WorkspaceToolName[];
}): string {
  const completed = input.completedTools?.length
    ? `已完成工具：${input.completedTools.join("、")}。`
    : "当前没有已完成工具。";
  return `${loadPromptTemplate(input.kind === "challenge" ? "manager/prompts/challenge" : "manager/prompts/baseline")}\n${completed}`;
}

const workspaceToolNameSet = new Set<string>(workspaceToolNames);
const baselineModuleTools = [
  { toolName: "analyze_argument", moduleType: "argument" },
  { toolName: "research_sources", moduleType: "sources" },
  { toolName: "map_perspectives", moduleType: "perspectives" },
  { toolName: "review_risks", moduleType: "risks" },
] as const;
const baselineRequirements = [
  "analyze_argument",
  "research_sources",
  "map_perspectives",
  "review_risks",
  "synthesize_report",
  "review_draft",
  "revise_report",
  "publish_report",
] as const;

export class ManagerAgentRuntime {
  constructor(
    private readonly createSession: ManagerAgentSessionFactory,
    private readonly executor: ManagerAgentToolExecutor,
    private readonly repository: ManagerAgentContextRepository,
  ) {}

  async run(input: ManagerAgentRunInput): Promise<ManagerAgentRunResult> {
    let context: ManagerAgentContext | undefined;
    let session: ExpertSession | undefined;
    let unsubscribe: (() => void) | undefined;
    let abort: (() => void) | undefined;
    let bridgeWrites = Promise.resolve();
    let bridgeError: unknown;
    try {
      context = await loadManagerAgentContext(this.repository, input);
      await this.appendEvent(context, "agent.ui.run.started", {
        runId: input.agentRunId,
        threadId: input.workspaceId,
        parentRunId: null,
        agentId: "manager",
        agentName: "客户经理",
      });
      const toolContext = {
        workspaceId: context.workspaceId,
        agentRunId: context.agentRunId,
        kind: context.kind,
        signal: context.signal,
        ...(context.messageId ? { messageId: context.messageId } : {}),
        ...(context.target ? { target: context.target } : {}),
      };
      const reportAction = createReportActionTool({
        ...toolContext,
        runReportAction: (actionInput) => this.executor.runReportAction(actionInput),
      });
      session = await this.createSession({
        systemPrompt: managerAgentInstructions,
        resourceDir: expertResourceDir("manager"),
        customTools: context.kind === "challenge"
          ? [reportAction]
          : [
              createDelegateExpertTool({
                ...toolContext,
                runExpert: (expertInput) => this.executor.runExpert(expertInput),
              }),
              reportAction,
            ],
      });
      const bridgeContext: PiEventBridgeContext = {
        runId: input.agentRunId,
        appendEvent: (eventType, payload) => this.appendEvent(context!, eventType, payload),
      };
      unsubscribe = session.subscribe((event) => {
        bridgeWrites = bridgeWrites
          .then(() => bridgePiEvent(event, bridgeContext))
          .catch((error: unknown) => { bridgeError ??= error; });
      });
      abort = () => void session?.abort?.();
      input.signal.addEventListener("abort", abort, { once: true });
      if (input.signal.aborted) abort();
      await session.prompt(promptForRun(context));
      await session.waitForIdle();
      await bridgeWrites;
      if (bridgeError) throw bridgeError;
      if (input.signal.aborted) {
        await this.appendEvent(context, "agent.ui.run.finished", {
          runId: input.agentRunId,
          outcome: "interrupt",
        });
        return { status: "interrupted" };
      }
      if (context.kind === "challenge") {
        await assertChallengeRunCompleted(this.repository, input, context.messageId);
      } else {
        await assertBaselineRunCompleted(this.repository, input);
      }
      await this.appendEvent(context, "agent.ui.run.finished", {
        runId: input.agentRunId,
        outcome: "success",
      });
      return { status: "completed" };
    } catch (error) {
      await bridgeWrites;
      const runError = bridgeError ?? error;
      if (input.signal.aborted) {
        if (context) {
          await this.appendEvent(context, "agent.ui.run.finished", {
            runId: input.agentRunId,
            outcome: "interrupt",
          });
        }
        return { status: "interrupted" };
      }
      if (context) {
        await this.appendEvent(context, "agent.ui.run.error", {
          runId: input.agentRunId,
          message: redactError(runError),
          code: errorCode(runError),
        });
      }
      throw runError;
    } finally {
      await bridgeWrites;
      if (abort) input.signal.removeEventListener("abort", abort);
      unsubscribe?.();
      session?.dispose?.();
    }
  }

  private appendEvent(
    context: ManagerAgentContext,
    eventType: Extract<
      AnalysisRepository extends { appendEvent(input: infer Input): unknown }
        ? Input extends { eventType: infer EventType } ? EventType : never
        : never,
      string
    >,
    payload: Record<string, unknown>,
  ): Promise<number> {
    return this.repository.appendEvent({
      jobId: context.workspaceId,
      userId: context.userId,
      eventType,
      payload,
      now: new Date(),
    });
  }
}

function redactError(error: unknown): string {
  return redactPiText(error instanceof Error ? error.message : "AGENT_RUN_FAILED").slice(0, 500);
}

function errorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : "AGENT_RUN_FAILED";
}

export async function loadManagerAgentContext(
  repository: ManagerAgentContextRepository,
  input: ManagerAgentRunInput,
): Promise<ManagerAgentContext> {
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
    userId: job.userId,
    signal: input.signal,
    kind: run.kind,
    completedTools: [...completedTools],
    ...(pendingMessage
      ? { messageId: pendingMessage.id, target: pendingMessage.target }
      : {}),
  };
}

async function resolveCompletedBaselineTools(
  repository: ManagerAgentContextRepository,
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

async function assertBaselineRunCompleted(
  repository: ManagerAgentContextRepository,
  input: ManagerAgentRunInput,
): Promise<void> {
  const context = await loadManagerAgentContext(repository, input);
  if (
    context.kind !== "baseline"
    || baselineRequirements.some((name) => !context.completedTools.includes(name))
  ) {
    throw new Error("BASELINE_INCOMPLETE");
  }
}

export async function assertChallengeRunCompleted(
  repository: ManagerAgentContextRepository,
  input: ManagerAgentRunInput,
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
