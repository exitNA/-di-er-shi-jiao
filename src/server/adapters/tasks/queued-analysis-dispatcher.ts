import type { AnalysisDispatcher } from "@/features/analysis/server/analysis-dispatcher";

export class QueuedAnalysisDispatcher implements AnalysisDispatcher {
  async enqueue(input: Parameters<AnalysisDispatcher["enqueue"]>[0]): Promise<{ runId: string }> {
    return { runId: `queued:${input.jobId}` };
  }
}
