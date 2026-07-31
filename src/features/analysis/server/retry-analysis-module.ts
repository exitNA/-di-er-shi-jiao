import type { AnalysisDispatcher } from "./analysis-dispatcher";
import type { AnalysisRepository } from "./analysis-repository";

const retryableModules = ["argument", "perspectives", "sources", "risks"] as const;

export type RetryableModuleType = (typeof retryableModules)[number];

type RetryResult =
  | { ok: true; jobId: string; moduleType: RetryableModuleType }
  | {
      ok: false;
      code:
        | "NOT_FOUND"
        | "MODULE_NOT_RETRYABLE"
        | "MODULE_NOT_FAILED"
        | "JOB_NOT_RETRYABLE"
        | "DISPATCH_FAILED";
    };

export async function retryAnalysisModule(
  input: { userId: string; jobId: string; moduleType: string },
  repository: AnalysisRepository,
  dispatcher: AnalysisDispatcher,
): Promise<RetryResult> {
  if (!isRetryableModule(input.moduleType)) {
    return { ok: false, code: "MODULE_NOT_RETRYABLE" };
  }

  const snapshot = await repository.getOwnedSnapshot(input.userId, input.jobId);
  if (!snapshot) return { ok: false, code: "NOT_FOUND" };

  const failedModule = snapshot.modules[input.moduleType];
  if (failedModule.status !== "failed") {
    return { ok: false, code: "MODULE_NOT_FAILED" };
  }
  if (snapshot.status !== "partial" && snapshot.status !== "recoverable") {
    return { ok: false, code: "JOB_NOT_RETRYABLE" };
  }

  const acquired = await repository.transitionJob(
    input.jobId,
    ["partial", "recoverable"],
    "running",
  );
  if (!acquired) return { ok: false, code: "JOB_NOT_RETRYABLE" };

  try {
    await dispatcher.enqueue({
      jobId: input.jobId,
      moduleType: input.moduleType,
      dispatchKey: `${input.jobId}:${input.moduleType}:${failedModule.version + 1}`,
    });
  } catch {
    await repository.transitionJob(input.jobId, ["running"], snapshot.status);
    return { ok: false, code: "DISPATCH_FAILED" };
  }

  return { ok: true, jobId: input.jobId, moduleType: input.moduleType };
}

function isRetryableModule(moduleType: string): moduleType is RetryableModuleType {
  return retryableModules.includes(moduleType as RetryableModuleType);
}
