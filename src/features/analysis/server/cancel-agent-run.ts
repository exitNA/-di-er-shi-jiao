import type { AnalysisDispatcher } from "./analysis-dispatcher";
import type { AnalysisRepository } from "./analysis-repository";

export type CancelAgentRunResult =
  | {
      ok: true;
      snapshot: NonNullable<Awaited<ReturnType<AnalysisRepository["getOwnedSnapshot"]>>>;
    }
  | { ok: false; code: "NOT_FOUND" | "RUN_NOT_CANCELLABLE" };

export async function cancelAgentRun(
  input: { userId: string; workspaceId: string; agentRunId: string },
  repository: AnalysisRepository,
  dispatcher: AnalysisDispatcher,
  now: () => Date = () => new Date(),
): Promise<CancelAgentRunResult> {
  const snapshot = await repository.getOwnedSnapshot(input.userId, input.workspaceId);
  if (!snapshot || snapshot.activeRun?.id !== input.agentRunId) {
    return { ok: false, code: "NOT_FOUND" };
  }
  if (
    snapshot.activeRun.status !== "queued"
    && snapshot.activeRun.status !== "running"
    && snapshot.activeRun.status !== "recoverable"
  ) {
    return { ok: false, code: "RUN_NOT_CANCELLABLE" };
  }

  const cancellation = await repository.requestAgentRunCancellation({
    workspaceId: input.workspaceId,
    userId: input.userId,
    agentRunId: input.agentRunId,
    now: now(),
  });
  if (!cancellation) return { ok: false, code: "RUN_NOT_CANCELLABLE" };
  if (cancellation.triggerRunId) {
    try {
      await dispatcher.cancel?.(cancellation.triggerRunId);
    } catch {
      // The persisted cancellation keeps later tools and claims from running.
    }
  }

  const latest = await repository.getOwnedSnapshot(input.userId, input.workspaceId);
  return latest
    ? { ok: true, snapshot: latest }
    : { ok: false, code: "NOT_FOUND" };
}
