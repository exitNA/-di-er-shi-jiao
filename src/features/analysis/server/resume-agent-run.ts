import type { AnalysisDispatcher } from "./analysis-dispatcher";
import type { AnalysisRepository } from "./analysis-repository";

export type ResumeAgentRunResult =
  | {
      ok: true;
      snapshot: NonNullable<Awaited<ReturnType<AnalysisRepository["getOwnedSnapshot"]>>>;
    }
  | { ok: false; code: "NOT_FOUND" | "RUN_NOT_RESUMABLE" | "DISPATCH_FAILED" };

export async function resumeAgentRun(
  input: { userId: string; workspaceId: string; agentRunId: string },
  repository: AnalysisRepository,
  dispatcher: AnalysisDispatcher,
  now: () => Date = () => new Date(),
): Promise<ResumeAgentRunResult> {
  const snapshot = await repository.getOwnedSnapshot(input.userId, input.workspaceId);
  if (!snapshot) {
    return { ok: false, code: "NOT_FOUND" };
  }
  const activeRun = snapshot.activeRun;
  if (!activeRun || activeRun.id !== input.agentRunId) {
    return { ok: false, code: "NOT_FOUND" };
  }
  if (activeRun.status !== "interrupted" && activeRun.status !== "recoverable") {
    return { ok: false, code: "RUN_NOT_RESUMABLE" };
  }
  const sharedRunInput = {
    workspaceId: input.workspaceId,
    userId: input.userId,
    configVersion: activeRun.configVersion,
    previousAgentRunId: input.agentRunId,
    now: now(),
  };
  const run = activeRun.kind === "challenge"
    ? activeRun.messageId
      ? await repository.createAgentRun({
          ...sharedRunInput,
          kind: "challenge",
          messageId: activeRun.messageId,
        })
      : null
    : await repository.createAgentRun({ ...sharedRunInput, kind: "baseline" });
  if (!run) return { ok: false, code: "RUN_NOT_RESUMABLE" };

  try {
    await dispatcher.enqueue({
      workspaceId: input.workspaceId,
      agentRunId: run.id,
      dispatchKey: `${input.workspaceId}:${run.id}`,
    });
  } catch {
    const claimed = await repository.claimAgentRun({
      workspaceId: input.workspaceId,
      userId: input.userId,
      agentRunId: run.id,
      now: now(),
    });
    if (claimed) {
      await repository.finishAgentRun({
        workspaceId: input.workspaceId,
        userId: input.userId,
        agentRunId: run.id,
        status: "recoverable",
        now: now(),
      });
    }
    return { ok: false, code: "DISPATCH_FAILED" };
  }

  const latest = await repository.getOwnedSnapshot(input.userId, input.workspaceId);
  return latest
    ? { ok: true, snapshot: latest }
    : { ok: false, code: "NOT_FOUND" };
}
