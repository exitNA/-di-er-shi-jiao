import { tasks } from "@trigger.dev/sdk";
import type { AnalysisDispatcher } from "@/features/analysis/server/analysis-dispatcher";
import type { runBaselineAnalysisTask } from "@/trigger/run-baseline-analysis";

export class TriggerAnalysisDispatcher implements AnalysisDispatcher {
  async enqueue(
    input: Parameters<AnalysisDispatcher["enqueue"]>[0],
  ): Promise<{ runId: string }> {
    const { dispatchKey, ...payload } = input;
    const handle = await tasks.trigger<typeof runBaselineAnalysisTask>(
      "run-baseline-analysis",
      payload,
      { idempotencyKey: dispatchKey },
    );
    return { runId: handle.id };
  }
}
