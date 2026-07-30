import { randomUUID } from "node:crypto";
import { logError } from "@/server/observability/logger";
import type { ProductEventRecorder } from "@/server/observability/product-events";
import type { AnalysisDispatcher } from "./analysis-dispatcher";
import type { AnalysisRepository } from "./analysis-repository";

const maxContentLength = 20_000;

export type SubmitAnalysisInput = {
  userId: string;
  content: string;
  idempotencyKey: string;
};

export type SubmitAnalysisResult =
  | { ok: true; jobId: string; created: boolean }
  | { ok: false; code: "EMPTY" | "TOO_LONG" | "UNSAFE_CONTENT" };

export async function submitAnalysis(
  input: SubmitAnalysisInput,
  repository: AnalysisRepository,
  dispatcher: AnalysisDispatcher,
  now: () => Date = () => new Date(),
  recordProductEvent: ProductEventRecorder = async () => false,
): Promise<SubmitAnalysisResult> {
  if (!input.content.trim()) return { ok: false, code: "EMPTY" };
  if (input.content.length > maxContentLength) return { ok: false, code: "TOO_LONG" };
  if (hasUnsafeControlCharacter(input.content)) return { ok: false, code: "UNSAFE_CONTENT" };

  const jobId = randomUUID();
  const created = await repository.createAnalysis({
    jobId,
    materialId: randomUUID(),
    reportId: randomUUID(),
    userId: input.userId,
    content: input.content,
    detectedLanguage: detectLanguage(input.content),
    idempotencyKey: input.idempotencyKey,
    configVersion: "baseline-v1",
    now: now(),
  });

  if (created.created) {
    try {
      await recordProductEvent({
        eventName: "analysis_submitted",
        jobId: created.jobId,
        userId: input.userId,
        now: now(),
      });
    } catch {
      logError({
        operation: "product_event.record",
        jobId: created.jobId,
        errorCode: "PRODUCT_EVENT_FAILED",
      });
    }

    try {
      await dispatcher.enqueue({ jobId: created.jobId, dispatchKey: `${created.jobId}:baseline` });
    } catch {
      const transitioned = await repository.transitionJob(
        created.jobId,
        ["queued"],
        "recoverable",
        { failureCode: "DISPATCH_FAILED", now: now() },
      );
      if (transitioned) {
        await repository.appendEvent({
          jobId: created.jobId,
          userId: input.userId,
          eventType: "job.recoverable",
          payload: { errorCode: "DISPATCH_FAILED" },
          now: now(),
        });
      }
    }
  }

  return { ok: true, jobId: created.jobId, created: created.created };
}

function detectLanguage(content: string): "zh" | "en" | "mixed" {
  const hasChinese = /\p{Script=Han}/u.test(content);
  const hasLatin = /\p{Script=Latin}/u.test(content);
  return hasChinese && hasLatin ? "mixed" : hasLatin ? "en" : "zh";
}

function hasUnsafeControlCharacter(content: string): boolean {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(content);
}
