import type { WorkspaceAgentRunInput, WorkspaceAgentRunResult } from "@/server/agents/workspace-agent-runtime";
import { getLogger } from "@logtape/logtape";
import type { AnalysisRepository } from "./analysis-repository";

const logger = getLogger(["second-perspective", "agent-run"]);

export interface AnalysisDispatcher {
  enqueue(input: {
    workspaceId: string;
    agentRunId: string;
    dispatchKey: string;
  }): Promise<{ runId: string }>;
  cancel?(triggerRunId: string): Promise<void>;
}

type AgentRunLifecycleRepository = Pick<
  AnalysisRepository,
  | "claimAgentRun"
  | "finishAgentRun"
  | "getJobForExecution"
  | "requestAgentRunCancellation"
>;

export async function executeAgentRun(
  input: WorkspaceAgentRunInput & { triggerRunId: string },
  runtime: { run(input: WorkspaceAgentRunInput): Promise<WorkspaceAgentRunResult> },
  repository: AgentRunLifecycleRepository,
  now: () => Date = () => new Date(),
): Promise<"completed" | "interrupted" | "recoverable" | "unavailable"> {
  const startedAt = Date.now();
  const job = await repository.getJobForExecution(input.workspaceId);
  if (!job) {
    logger.warning("Agent run unavailable", { workspaceId: input.workspaceId, agentRunId: input.agentRunId });
    return "unavailable";
  }

  const claimed = await repository.claimAgentRun({
    workspaceId: input.workspaceId,
    userId: job.userId,
    agentRunId: input.agentRunId,
    triggerRunId: input.triggerRunId,
    now: now(),
  });
  if (!claimed) return "unavailable";
  logger.info("Agent run started", { workspaceId: input.workspaceId, agentRunId: input.agentRunId, triggerRunId: input.triggerRunId });

  try {
    const result = await runtime.run({
      workspaceId: input.workspaceId,
      agentRunId: input.agentRunId,
      signal: input.signal,
    });
    if (result.status === "interrupted") {
      await repository.requestAgentRunCancellation({
        workspaceId: input.workspaceId,
        userId: job.userId,
        agentRunId: input.agentRunId,
        now: now(),
      });
      logger.info("Agent run interrupted", { workspaceId: input.workspaceId, agentRunId: input.agentRunId, durationMs: Date.now() - startedAt });
      return "interrupted";
    }
    await repository.finishAgentRun({
      workspaceId: input.workspaceId,
      userId: job.userId,
      agentRunId: input.agentRunId,
      status: "completed",
      now: now(),
    });
    logger.info("Agent run completed", { workspaceId: input.workspaceId, agentRunId: input.agentRunId, durationMs: Date.now() - startedAt });
    return "completed";
  } catch (error) {
    if (input.signal.aborted) {
      await repository.requestAgentRunCancellation({
        workspaceId: input.workspaceId,
        userId: job.userId,
        agentRunId: input.agentRunId,
        now: now(),
      });
      logger.info("Agent run interrupted", { workspaceId: input.workspaceId, agentRunId: input.agentRunId, durationMs: Date.now() - startedAt });
      return "interrupted";
    }
    await repository.finishAgentRun({
      workspaceId: input.workspaceId,
      userId: job.userId,
      agentRunId: input.agentRunId,
      status: "recoverable",
      now: now(),
    });
    logger.error("Agent run failed", { workspaceId: input.workspaceId, agentRunId: input.agentRunId, durationMs: Date.now() - startedAt, errorCode: errorCode(error), errorName: error instanceof Error ? error.name : "unknown" });
    return "recoverable";
  }
}

function errorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : "AGENT_RUN_FAILED";
}
