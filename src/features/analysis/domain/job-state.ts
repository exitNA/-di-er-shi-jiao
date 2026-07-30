export const analysisJobStatuses = [
  "queued",
  "running",
  "partial",
  "completed",
  "recoverable",
] as const;

export type AnalysisJobStatus = (typeof analysisJobStatuses)[number];

export const reportModuleStatuses = ["queued", "running", "completed", "failed"] as const;

export type ReportModuleStatus = (typeof reportModuleStatuses)[number];

const jobTransitions: Record<AnalysisJobStatus, readonly AnalysisJobStatus[]> = {
  queued: ["running"],
  running: ["partial", "completed", "recoverable"],
  partial: ["running", "completed", "recoverable"],
  completed: [],
  recoverable: ["running"],
};

export function canTransitionJob(from: AnalysisJobStatus, to: AnalysisJobStatus): boolean {
  return jobTransitions[from].includes(to);
}

export function assertJobTransition(from: AnalysisJobStatus, to: AnalysisJobStatus): void {
  if (!canTransitionJob(from, to)) {
    throw new Error(`Invalid analysis job transition: ${from} -> ${to}`);
  }
}

export function canTransitionModule(
  from: ReportModuleStatus,
  to: ReportModuleStatus,
  revision = false,
): boolean {
  if (from === "completed" && to === "running") {
    return revision;
  }

  return (
    (from === "queued" && to === "running") ||
    (from === "running" && (to === "completed" || to === "failed")) ||
    (from === "failed" && to === "running")
  );
}

export function assertModuleTransition(
  from: ReportModuleStatus,
  to: ReportModuleStatus,
  revision = false,
): void {
  if (!canTransitionModule(from, to, revision)) {
    throw new Error(`Invalid report module transition: ${from} -> ${to}`);
  }
}
