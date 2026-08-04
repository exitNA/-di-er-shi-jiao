import { task } from "@trigger.dev/sdk";
import { executeAgentRun } from "@/features/analysis/server/analysis-dispatcher";
import { getContainer } from "@/server/container";
import {
  flushObservability,
  startObservability,
} from "@/server/observability/tracing";

export const runAgentTask = task({
  id: "run-agent",
  run: async (
    payload: { workspaceId: string; agentRunId: string },
    { ctx, signal },
  ) => {
    await startObservability({ isolated: true });
    try {
      const container = getContainer();
      return await executeAgentRun(
        {
          ...payload,
          triggerRunId: ctx.run.id,
          signal,
        },
        container.workspaceAgentRuntime,
        container.analysisRepository,
      );
    } finally {
      await flushObservability();
    }
  },
});
