import { task } from "@trigger.dev/sdk";
import { executeAgentRun } from "@/features/analysis/server/analysis-dispatcher";
import { getContainer } from "@/server/container";

export const runAgentTask = task({
  id: "run-agent",
  run: async (
    payload: { workspaceId: string; agentRunId: string },
    { ctx, signal },
  ) => {
    const container = getContainer();
    return executeAgentRun(
      {
        ...payload,
        triggerRunId: ctx.run.id,
        signal,
      },
      container.workspaceAgentRuntime,
      container.analysisRepository,
    );
  },
});
