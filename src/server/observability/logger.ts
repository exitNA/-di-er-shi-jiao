export type SafeLogEvent = {
  operation: string;
  jobId?: string;
  moduleType?: string;
  durationMs?: number;
  attempt?: number;
};

export function logInfo(event: SafeLogEvent): void {
  console.info(serialize("info", event));
}

export function logError(
  event: SafeLogEvent & { errorCode: string },
): void {
  console.error(serialize("error", event));
}

function serialize(
  level: "info" | "error",
  event: SafeLogEvent & { errorCode?: string },
): string {
  const safeEvent = {
    level,
    operation: event.operation,
    ...(event.jobId ? { jobId: event.jobId } : {}),
    ...(event.moduleType ? { moduleType: event.moduleType } : {}),
    ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
    ...(event.attempt === undefined ? {} : { attempt: event.attempt }),
    ...(event.errorCode ? { errorCode: event.errorCode } : {}),
  };
  return JSON.stringify(safeEvent);
}
