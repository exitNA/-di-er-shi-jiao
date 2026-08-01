import { randomUUID } from "node:crypto";
import { getLogger } from "@logtape/logtape";

import {
  argumentModuleSchema,
  overviewModuleSchema,
  perspectivesModuleSchema,
  reflectionModuleSchema,
  risksModuleSchema,
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
import type { ProductEventRecorder } from "@/server/observability/product-events";

const logger = getLogger(["second-perspective", "conversation"]);
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

    const current = snapshot.modules[message.target.moduleType];
    if (!current.payload) return this.recover(input, snapshot.reportId);

    const runId = randomUUID();
    const started = Date.now();
    await this.repository.startExpertRun({
      id: runId,
      jobId: input.jobId,
      expertType: expertType(message.target.moduleType),
      phase: "revision",
      attempt: current.version + 1,
      configVersion: snapshot.configVersion,
      now: this.now(),
    });

    try {
      const review = await this.experts.reviewTarget({
        material: job.material,
        target: message.target,
        currentModule: current.payload as BaselineDraft[ReportModuleType],
        conversation: snapshot.messages,
        newSources: (snapshot.modules.sources.payload as SourcesModule | undefined)?.sources,
      });
      const replacement = review.value.replacement ?? {
        module: current.payload as BaselineDraft[ReportModuleType],
        reason: "复核后现有内容仍受当前证据支持。",
        newEvidenceSourceIds: [],
        summary: "保留目标条目的当前结论。",
      };
      const parsedModule = moduleSchemas[message.target.moduleType].parse(replacement.module);
      await this.repository.finishExpertRun({
        id: runId,
        status: "completed",
        inputTokens: review.usage.inputTokens,
        outputTokens: review.usage.outputTokens,
        estimatedCostUsd: "0",
        latencyMs: review.usage.latencyMs || Date.now() - started,
        now: this.now(),
      });
      const completed = await this.repository.completeRevision({
        jobId: input.jobId,
        reportId: snapshot.reportId,
        userId: input.userId,
        messageId: input.messageId,
        agentContent: review.value.responseText,
        expectedReportVersion: snapshot.currentVersion,
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
        return this.recover(input, snapshot.reportId);
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
      await this.repository.finishExpertRun({
        id: runId,
        status: "failed",
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: "0",
        latencyMs: Date.now() - started,
        errorCode: code,
        now: this.now(),
      });
      logger.error("Report challenge failed", {
        jobId: input.jobId,
        messageId: input.messageId,
        moduleType: message.target.moduleType,
        status: "recoverable",
        errorCode: code,
      });
      return this.recover(input, snapshot.reportId);
    }
  }

  private async recover(
    input: { userId: string; jobId: string; messageId: string },
    reportId: string,
  ): Promise<{ status: "recoverable" }> {
    await this.repository.recoverRevision({ ...input, reportId, now: this.now() });
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

function expertType(moduleType: ReportModuleType) {
  switch (moduleType) {
    case "argument": return "argument" as const;
    case "sources": return "sources" as const;
    case "perspectives": return "perspectives" as const;
    case "risks": return "risks" as const;
    case "overview":
    case "reflection": return "synthesis" as const;
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
