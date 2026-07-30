import { task } from "@trigger.dev/sdk";
import type { ReportModuleType } from "@/features/analysis/domain/contracts";
import { getContainer } from "@/server/container";

export const runBaselineAnalysisTask = task({
  id: "run-baseline-analysis",
  run: async (payload: { jobId: string; moduleType?: ReportModuleType }) => {
    return getContainer().baselineOrchestrator.run({
      jobId: payload.jobId,
      onlyModule: payload.moduleType,
    });
  },
});
