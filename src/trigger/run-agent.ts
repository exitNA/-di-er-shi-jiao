import { task } from "@trigger.dev/sdk";
import { executeAgentRun } from "@/features/analysis/server/analysis-dispatcher";
import { getContainer } from "@/server/container";
import {
  flushLangfuseTracing,
  startLangfuseTracing,
} from "@/server/observability/tracing";

export const runAgentTask = task({
  id: "run-agent",
  run: async (
    payload: { workspaceId: string; agentRunId: string },
    { ctx, signal },
  ) => {
    await startLangfuseTracing({ isolated: true });
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
      await flushLangfuseTracing();
    }
  },
});
