import type { ReportModuleType } from "@/features/analysis/domain/contracts";

export interface AnalysisDispatcher {
  enqueue(input: {
    jobId: string;
    moduleType?: ReportModuleType;
    dispatchKey: string;
  }): Promise<{ runId: string }>;
}
