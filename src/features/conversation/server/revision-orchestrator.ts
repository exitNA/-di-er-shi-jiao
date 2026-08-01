import { randomUUID } from "node:crypto";
import { getLogger } from "@logtape/logtape";

import {
  argumentModuleSchema,
  isTargetScopedModuleReplacement,
  overviewModuleSchema,
  perspectivesModuleSchema,
  reflectionModuleSchema,
  risksModuleSchema,
  resolveReportItemTarget,
  sourcesModuleSchema,
  type BaselineDraft,
  type SourcesModule,
  type ReportModuleType,
} from "@/features/analysis/domain/contracts";
import type {
  AnalysisRepository,
  RevisionModuleUpdate,
} from "@/features/analysis/server/analysis-repository";
import type { RevisionRunResult } from "@/features/conversation/domain/contracts";
import type { ExpertSuite } from "@/server/agents/expert-suite";
import { withTimeout } from "@/server/agents/baseline-orchestrator";
import type { ProductEventRecorder } from "@/server/observability/product-events";

const logger = getLogger(["second-perspective", "conversation"]);
const revisionLeaseMs = 30_000;
const moduleSchemas = {
  overview: overviewModuleSchema,
  argument: argumentModuleSchema,
  perspectives: perspectivesModuleSchema,
  sources: sourcesModuleSchema,
  risks: risksModuleSchema,
  reflection: reflectionModuleSchema,
};

export class RevisionOrchestrator {
  constructor(
    private readonly experts: ExpertSuite,
    private readonly repository: AnalysisRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly recordProductEvent: ProductEventRecorder = async () => false,
    private readonly timeoutMs = 25_000,
  ) {}

  async run(input: {
    userId: string;
    jobId: string;
    messageId: string;
  }): Promise<RevisionRunResult> {
    const job = await this.repository.getJobForExecution(input.jobId);
    const snapshot = await this.repository.getOwnedSnapshot(input.userId, input.jobId);
    const message = snapshot?.messages.find(
      (candidate) => candidate.id === input.messageId && candidate.role === "user",
    );
    if (!job || job.userId !== input.userId || !snapshot || !message) {
      return { status: "not-found" };
    }

    const existing = snapshot.revisions.find(
      (revision) => revision.triggeringMessageId === input.messageId,
    );
    if (existing) return { status: "completed", revisionId: existing.id };
    if (message.status === "completed") return { status: "completed" };

    const leaseId = randomUUID();
    const leaseStartedAt = this.now();
    const acquired = await this.repository.startRevision({
      ...input,
      reportId: snapshot.reportId,
      leaseId,
      leaseExpiresAt: new Date(leaseStartedAt.getTime() + revisionLeaseMs),
      now: leaseStartedAt,
    });
    if (!acquired) {
      const latest = await this.repository.getOwnedSnapshot(input.userId, input.jobId);
      const revision = latest?.revisions.find(
        (candidate) => candidate.triggeringMessageId === input.messageId,
      );
      if (revision) return { status: "completed", revisionId: revision.id };
      const status = latest?.messages.find(
        (candidate) => candidate.id === input.messageId,
      )?.status;
      return status === "completed"
        ? { status: "completed" }
        : status === "running"
          ? { status: "running" }
          : { status: "recoverable" };
    }

    const executionSnapshot = await this.repository.getOwnedSnapshot(input.userId, input.jobId);
    if (!executionSnapshot || !resolveReportItemTarget(executionSnapshot.modules, message.target)) {
      return this.recover(input, snapshot.reportId, leaseId);
    }
    const current = executionSnapshot.modules[message.target.moduleType];
    if (!current.payload) return this.recover(input, snapshot.reportId, leaseId);

    try {
      const review = await withTimeout(this.timeoutMs, (abortSignal) =>
        this.experts.reviewTarget({
          material: job.material,
          target: message.target,
          currentModule: current.payload as BaselineDraft[ReportModuleType],
          conversation: executionSnapshot.messages,
          newSources: (executionSnapshot.modules.sources.payload as SourcesModule | undefined)?.sources,
          abortSignal,
        }),
      );
      const replacement = review.value.replacement;
      if (!replacement) {
        const completed = await this.repository.completeRevisionResponse({
          ...input,
          reportId: snapshot.reportId,
          leaseId,
          agentContent: review.value.responseText,
          expectedReportVersion: executionSnapshot.currentVersion,
          now: this.now(),
        });
        if (!completed) return this.recover(input, snapshot.reportId, leaseId);
        logger.info("Report challenge completed", {
          jobId: input.jobId,
          messageId: input.messageId,
          moduleType: message.target.moduleType,
          status: "completed",
          revised: false,
        });
        return { status: "completed" };
      }
      const parsedModule = moduleSchemas[message.target.moduleType].parse(replacement.module);
      if (!isTargetScopedModuleReplacement(
        current.payload as BaselineDraft[ReportModuleType],
        parsedModule,
        message.target,
      )) {
        return this.recover(input, snapshot.reportId, leaseId);
      }
      const completed = await this.repository.completeRevision({
        jobId: input.jobId,
        reportId: snapshot.reportId,
        userId: input.userId,
        messageId: input.messageId,
        leaseId,
        agentContent: review.value.responseText,
        expectedReportVersion: executionSnapshot.currentVersion,
        module: revisionModule(
          message.target.moduleType,
          parsedModule,
          current.version,
        ),
        changes: [{
          target: message.target,
          reason: replacement.reason,
          newEvidenceSourceIds: replacement.newEvidenceSourceIds,
          summary: replacement.summary,
        }],
        now: this.now(),
      });
      if (!completed.completed || !completed.revisionId) {
        return this.recover(input, snapshot.reportId, leaseId);
      }
      await this.recordProductEventSafely({
        userId: input.userId,
        jobId: input.jobId,
        eventName: "report_revised",
        revisionId: completed.revisionId,
        moduleType: message.target.moduleType,
        now: this.now(),
      });
      logger.info("Report challenge completed", {
        jobId: input.jobId,
        messageId: input.messageId,
        revisionId: completed.revisionId,
        moduleType: message.target.moduleType,
        status: "completed",
      });
      return { status: "completed", revisionId: completed.revisionId };
    } catch (error) {
      const code = errorCode(error);
      logger.error("Report challenge failed", {
        jobId: input.jobId,
        messageId: input.messageId,
        moduleType: message.target.moduleType,
        status: "recoverable",
        errorCode: code,
      });
      return this.recover(input, snapshot.reportId, leaseId);
    }
  }

  private async recover(
    input: { userId: string; jobId: string; messageId: string },
    reportId: string,
    leaseId: string,
  ): Promise<{ status: "recoverable" }> {
    await this.repository.recoverRevision({ ...input, reportId, leaseId, now: this.now() });
    return { status: "recoverable" };
  }

  private async recordProductEventSafely(
    input: Parameters<ProductEventRecorder>[0],
  ): Promise<void> {
    try {
      await this.recordProductEvent(input);
    } catch {
      logger.error("Product event recording failed", {
        jobId: input.jobId,
        eventName: input.eventName,
        errorCode: "PRODUCT_EVENT_FAILED",
      });
    }
  }
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  if (error instanceof Error && error.name === "ZodError") return "INVALID_EXPERT_OUTPUT";
  return "EXPERT_FAILED";
}

function revisionModule(
  moduleType: ReportModuleType,
  payload: BaselineDraft[ReportModuleType],
  currentVersion: number,
): RevisionModuleUpdate {
  const versions = {
    expectedVersion: currentVersion,
    nextVersion: currentVersion + 1,
  };
  switch (moduleType) {
    case "overview": return { moduleType, payload: overviewModuleSchema.parse(payload), ...versions };
    case "argument": return { moduleType, payload: argumentModuleSchema.parse(payload), ...versions };
    case "perspectives": return { moduleType, payload: perspectivesModuleSchema.parse(payload), ...versions };
    case "sources": return { moduleType, payload: sourcesModuleSchema.parse(payload), ...versions };
    case "risks": return { moduleType, payload: risksModuleSchema.parse(payload), ...versions };
    case "reflection": return { moduleType, payload: reflectionModuleSchema.parse(payload), ...versions };
  }
}
