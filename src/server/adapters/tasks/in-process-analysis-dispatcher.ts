import type { AnalysisDispatcher } from "@/features/analysis/server/analysis-dispatcher";
import type { BaselineOrchestrator } from "@/server/agents/baseline-orchestrator";

export class InProcessAnalysisDispatcher implements AnalysisDispatcher {
  constructor(
    private readonly orchestrator: Pick<BaselineOrchestrator, "run">,
  ) {}

  async enqueue(
    input: Parameters<AnalysisDispatcher["enqueue"]>[0],
  ): Promise<{ runId: string }> {
    queueMicrotask(() => {
      void this.orchestrator
        .run({ jobId: input.jobId, onlyModule: input.moduleType })
        .catch(() => undefined);
    });
    return {
      runId: `in-process:${input.jobId}:${input.moduleType ?? "baseline"}`,
    };
  }
}
