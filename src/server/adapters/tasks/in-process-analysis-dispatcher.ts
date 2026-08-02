import {
  executeAgentRun,
  type AnalysisDispatcher,
} from "@/features/analysis/server/analysis-dispatcher";
import type { AnalysisRepository } from "@/features/analysis/server/analysis-repository";
import type { WorkspaceAgentRuntime } from "@/server/agents/workspace-agent-runtime";

export class InProcessAnalysisDispatcher implements AnalysisDispatcher {
  private readonly executions = new Map<
    string,
    { controller: AbortController; promise: Promise<unknown> }
  >();

  constructor(
    private readonly runtime: Pick<WorkspaceAgentRuntime, "run">,
    private readonly repository: Pick<
      AnalysisRepository,
      "claimAgentRun" | "finishAgentRun" | "getJobForExecution" | "requestAgentRunCancellation"
    >,
  ) {}

  async enqueue(
    input: Parameters<AnalysisDispatcher["enqueue"]>[0],
  ): Promise<{ runId: string }> {
    const runId = `in-process:${input.agentRunId}`;
    const controller = new AbortController();
    const execution = {
      controller,
      promise: Promise.resolve().then(() => executeAgentRun(
        {
          workspaceId: input.workspaceId,
          agentRunId: input.agentRunId,
          triggerRunId: runId,
          signal: controller.signal,
        },
        this.runtime,
        this.repository,
      )).catch(() => undefined),
    };
    this.executions.set(runId, execution);
    void execution.promise.finally(() => {
      if (this.executions.get(runId) === execution) this.executions.delete(runId);
    });
    return { runId };
  }

  async cancel(runId: string): Promise<void> {
    const execution = this.executions.get(runId);
    if (!execution) return;
    execution.controller.abort();
    await execution.promise;
  }
}
