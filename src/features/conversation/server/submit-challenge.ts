import { getLogger } from "@logtape/logtape";

import {
  resolveReportItemTarget,
  type ConversationMessage,
  type ReportItemTarget,
} from "@/features/analysis/domain/contracts";
import type { AnalysisRepository } from "@/features/analysis/server/analysis-repository";
import type { ProductEventRecorder } from "@/server/observability/product-events";
import type { RevisionOrchestrator } from "./revision-orchestrator";

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
      revisionId?: string;
      created: boolean;
      status: ConversationMessage["status"];
    }
  | { ok: false; code: "INVALID_TARGET" | "NOT_FOUND" };

export async function submitChallenge(
  input: SubmitChallengeInput,
  repository: AnalysisRepository,
  orchestrator: RevisionOrchestrator,
  now: () => Date = () => new Date(),
  recordProductEvent: ProductEventRecorder = async () => false,
): Promise<SubmitChallengeResult> {
  const snapshot = await repository.getOwnedSnapshot(input.userId, input.jobId);
  if (!snapshot) return { ok: false, code: "NOT_FOUND" };
  const targetExists = resolveReportItemTarget(snapshot.modules, input.target);
  const challenge = targetExists
    ? await repository.createChallenge({
        ...input,
        reportId: snapshot.reportId,
        now: now(),
      })
    : await repository.findChallengeByIdempotency({
        userId: input.userId,
        jobId: input.jobId,
        reportId: snapshot.reportId,
        idempotencyKey: input.idempotencyKey,
      }).then((existing) => existing && { ...existing, created: false });
  if (!challenge) {
    return { ok: false, code: targetExists ? "NOT_FOUND" : "INVALID_TARGET" };
  }

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

  const result = await orchestrator.run({
    userId: input.userId,
    jobId: input.jobId,
    messageId: challenge.messageId,
  });
  if (result.status === "not-found") return { ok: false, code: "NOT_FOUND" };
  return {
    ok: true,
    messageId: challenge.messageId,
    ...(result.status === "completed" ? { revisionId: result.revisionId } : {}),
    created: challenge.created,
    status: result.status,
  };
}
