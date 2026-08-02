import { getLogger } from "@logtape/logtape";

import {
  resolveReportItemTarget,
  type ConversationMessage,
  type ReportItemTarget,
} from "@/features/analysis/domain/contracts";
import type { AnalysisDispatcher } from "@/features/analysis/server/analysis-dispatcher";
import type { AnalysisRepository } from "@/features/analysis/server/analysis-repository";
import type { ProductEventRecorder } from "@/server/observability/product-events";

const logger = getLogger(["second-perspective", "conversation"]);

export type SubmitChallengeInput = {
  userId: string;
  jobId: string;
  target: ReportItemTarget;
  content: string;
  idempotencyKey: string;
};

export type SubmitChallengeResult =
  | {
      ok: true;
      messageId: string;
      agentRunId: string;
      created: boolean;
      status: ConversationMessage["status"];
    }
  | { ok: false; code: "INVALID_TARGET" | "NOT_FOUND" | "RUN_BUSY" };

export async function submitChallenge(
  input: SubmitChallengeInput,
  repository: AnalysisRepository,
  dispatcher: AnalysisDispatcher,
  now: () => Date = () => new Date(),
  recordProductEvent: ProductEventRecorder = async () => false,
): Promise<SubmitChallengeResult> {
  const snapshot = await repository.getOwnedSnapshot(input.userId, input.jobId);
  if (!snapshot) return { ok: false, code: "NOT_FOUND" };
  const targetExists = resolveReportItemTarget(snapshot.modules, input.target);
  if (!targetExists) {
    const existing = await repository.findChallengeByIdempotency({
      userId: input.userId,
      jobId: input.jobId,
      reportId: snapshot.reportId,
      idempotencyKey: input.idempotencyKey,
    });
    if (!existing) return { ok: false, code: "INVALID_TARGET" };
  }
  const challenge = await repository.createChallengeAgentRun({
    ...input,
    reportId: snapshot.reportId,
    configVersion: "agent-v1",
    now: now(),
  });
  if (!challenge) return { ok: false, code: "NOT_FOUND" };
  if ("code" in challenge) return { ok: false, code: challenge.code };

  if (challenge.created) {
    await repository.appendEvent({
      jobId: input.jobId,
      userId: input.userId,
      eventType: "conversation.updated",
      payload: { messageId: challenge.messageId, status: "queued" },
      now: now(),
    });

    try {
      await recordProductEvent({
        userId: input.userId,
        jobId: input.jobId,
        eventName: "report_item_challenged",
        messageId: challenge.messageId,
        moduleType: input.target.moduleType,
        now: now(),
      });
    } catch {
      logger.error("Product event recording failed", {
        jobId: input.jobId,
        messageId: challenge.messageId,
        eventName: "report_item_challenged",
        errorCode: "PRODUCT_EVENT_FAILED",
      });
    }
  }

  let status = challenge.status;
  if (challenge.shouldEnqueue) {
    try {
      await dispatcher.enqueue({
        workspaceId: input.jobId,
        agentRunId: challenge.agentRunId,
        dispatchKey: `${challenge.agentRunId}:challenge`,
      });
    } catch (error) {
      const recovered = await repository.finishAgentRun({
        workspaceId: input.jobId,
        userId: input.userId,
        agentRunId: challenge.agentRunId,
        status: "recoverable",
        now: now(),
      });
      const latest = recovered ? null : await repository.getOwnedSnapshot(input.userId, input.jobId);
      if (!recovered && latest?.messages.find((message) => message.id === challenge.messageId)?.status !== "recoverable") {
        throw error;
      }
      status = "recoverable";
    }
  }
  return {
    ok: true,
    messageId: challenge.messageId,
    agentRunId: challenge.agentRunId,
    created: challenge.created,
    status,
  };
}
