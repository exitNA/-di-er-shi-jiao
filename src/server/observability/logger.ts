export type SafeLogEvent = {
  operation: string;
  jobId?: string;
  moduleType?: string;
  durationMs?: number;
  attempt?: number;
  details?: Record<string, unknown>;
};

const sensitiveKeys = new Set([
  "content",
  "username",
  "password",
  "sessiontoken",
  "prompt",
  "response",
  "apikey",
]);

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
    ...(event.details ? { details: redact(event.details, new WeakSet()) } : {}),
  };
  return JSON.stringify(safeEvent);
}

function redact(value: unknown, seen: WeakSet<object>): unknown {
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      sensitiveKeys.has(key.toLowerCase())
        ? "[REDACTED]"
        : redact(nested, seen),
    ]),
  );
}
