import type { WorkspaceAgentRunInput, WorkspaceAgentRunResult } from "@/server/agents/workspace-agent-runtime";
import type { AnalysisRepository } from "./analysis-repository";

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
  const job = await repository.getJobForExecution(input.workspaceId);
  if (!job) return "unavailable";

  const claimed = await repository.claimAgentRun({
    workspaceId: input.workspaceId,
    userId: job.userId,
    agentRunId: input.agentRunId,
    triggerRunId: input.triggerRunId,
    now: now(),
  });
  if (!claimed) return "unavailable";

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
      return "interrupted";
    }
    await repository.finishAgentRun({
      workspaceId: input.workspaceId,
      userId: job.userId,
      agentRunId: input.agentRunId,
      status: "completed",
      now: now(),
    });
    return "completed";
  } catch {
    if (input.signal.aborted) {
      await repository.requestAgentRunCancellation({
        workspaceId: input.workspaceId,
        userId: job.userId,
        agentRunId: input.agentRunId,
        now: now(),
      });
      return "interrupted";
    }
    await repository.finishAgentRun({
      workspaceId: input.workspaceId,
      userId: job.userId,
      agentRunId: input.agentRunId,
      status: "recoverable",
      now: now(),
    });
    return "recoverable";
  }
}
