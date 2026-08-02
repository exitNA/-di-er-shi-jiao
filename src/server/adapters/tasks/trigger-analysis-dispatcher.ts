import { runs, tasks } from "@trigger.dev/sdk";
import type { AnalysisDispatcher } from "@/features/analysis/server/analysis-dispatcher";
import type { runAgentTask } from "@/trigger/run-agent";

export class TriggerAnalysisDispatcher implements AnalysisDispatcher {
  async enqueue(
    input: Parameters<AnalysisDispatcher["enqueue"]>[0],
  ): Promise<{ runId: string }> {
    const { dispatchKey, ...payload } = input;
    const handle = await tasks.trigger<typeof runAgentTask>(
      "run-agent",
      payload,
      { idempotencyKey: dispatchKey },
    );
    return { runId: handle.id };
  }

  async cancel(triggerRunId: string): Promise<void> {
    await runs.cancel(triggerRunId);
  }
}
