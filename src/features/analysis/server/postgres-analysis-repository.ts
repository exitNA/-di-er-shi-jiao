import { and, asc, desc, eq, exists, gt, inArray, isNull, lt, lte, notInArray, or, sql } from "drizzle-orm";
import type {
  AnalysisJobStatus,
  AnalysisSnapshot,
  ConversationMessage,
  ReportRevision,
  ReportModuleStatus,
} from "@/features/analysis/domain/contracts";
import {
  argumentModuleSchema,
  isTargetScopedModuleReplacement,
  moduleTypes,
  overviewModuleSchema,
  perspectivesModuleSchema,
  reflectionModuleSchema,
  reportModuleSourceIds,
  reportRevisionChangeSchema,
  risksModuleSchema,
  sourcesModuleSchema,
} from "@/features/analysis/domain/contracts";
import type { AppDb } from "@/server/db/client";
import { isPostgresUniqueViolation } from "@/server/db/postgres-errors";
import {
  analysisEvents,
  analysisJobs,
  analysisMaterials,
  conversationMessages,
  expertRuns,
  reportModules,
  reportRevisions,
  reports,
  reportSources,
} from "@/server/db/schema/analysis";
import type {
  AnalysisEvent,
  AnalysisRepository,
  CompleteRevisionResponse,
  CompleteRevision,
  ExecutionJob,
  FinishExpertRun,
  HistoryItem,
  NewChallenge,
  NewAnalysis,
  NewAnalysisEvent,
  RecoverRevision,
  SaveModule,
  StartExpertRun,
  StartRevision,
} from "./analysis-repository";

function asJobStatus(status: string): AnalysisJobStatus {
  return status as AnalysisJobStatus;
}

function asModuleStatus(status: string): ReportModuleStatus {
  return status as ReportModuleStatus;
}

const modulePayloadSchemas = {
  overview: overviewModuleSchema,
  argument: argumentModuleSchema,
  perspectives: perspectivesModuleSchema,
  sources: sourcesModuleSchema,
  risks: risksModuleSchema,
  reflection: reflectionModuleSchema,
};

function hasSameTarget(
  left: { moduleType: string; section: string; itemId: string },
  right: { moduleType: string; section: string; itemId: string },
): boolean {
  return left.moduleType === right.moduleType && left.section === right.section && left.itemId === right.itemId;
}

export class PostgresAnalysisRepository implements AnalysisRepository {
  constructor(private readonly db: AppDb) {}

  async createAnalysis(input: NewAnalysis): Promise<{ jobId: string; created: boolean }> {
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(analysisMaterials).values({
          id: input.materialId,
          userId: input.userId,
          content: input.content,
          characterCount: input.content.length,
          detectedLanguage: input.detectedLanguage,
          createdAt: input.now,
        });
        await tx.insert(analysisJobs).values({
          id: input.jobId,
          userId: input.userId,
          materialId: input.materialId,
          status: "queued",
          configVersion: input.configVersion,
          idempotencyKey: input.idempotencyKey,
          createdAt: input.now,
          updatedAt: input.now,
        });
        await tx.insert(reports).values({
          id: input.reportId,
          jobId: input.jobId,
          userId: input.userId,
          baselineVersion: 0,
          currentVersion: 0,
          createdAt: input.now,
          updatedAt: input.now,
        });
        await tx.insert(reportModules).values(
          moduleTypes.map((moduleType) => ({
            reportId: input.reportId,
            moduleType,
            status: "queued",
            payload: {},
            version: 0,
            createdAt: input.now,
            updatedAt: input.now,
          })),
        );
      });
      return { jobId: input.jobId, created: true };
    } catch (error) {
      if (!isPostgresUniqueViolation(error)) throw error;

      const [existing] = await this.db
        .select({ jobId: analysisJobs.id })
        .from(analysisJobs)
        .where(
          and(
            eq(analysisJobs.userId, input.userId),
            eq(analysisJobs.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (!existing) throw error;
      return { jobId: existing.jobId, created: false };
    }
  }

  async createChallenge(input: NewChallenge): Promise<{ messageId: string; created: boolean } | null> {
    const [ownedReport] = await this.db
      .select({ reportId: reports.id })
      .from(reports)
      .innerJoin(analysisJobs, eq(analysisJobs.id, reports.jobId))
      .where(
        and(
          eq(reports.id, input.reportId),
          eq(reports.userId, input.userId),
          eq(reports.jobId, input.jobId),
          eq(analysisJobs.userId, input.userId),
        ),
      )
      .limit(1);
    if (!ownedReport) return null;

    try {
      const [message] = await this.db
        .insert(conversationMessages)
        .values({
          reportId: input.reportId,
          userId: input.userId,
          role: "user",
          target: input.target,
          content: input.content,
          status: "queued",
          idempotencyKey: input.idempotencyKey,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning({ id: conversationMessages.id });
      return { messageId: message.id, created: true };
    } catch (error) {
      if (!isPostgresUniqueViolation(error)) throw error;

      const [message] = await this.db
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.reportId, input.reportId),
            eq(conversationMessages.userId, input.userId),
            eq(conversationMessages.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (!message) throw error;
      return { messageId: message.id, created: false };
    }
  }

  async findChallengeByIdempotency(
    input: Pick<NewChallenge, "idempotencyKey" | "jobId" | "reportId" | "userId">,
  ): Promise<{ messageId: string } | null> {
    const [message] = await this.db
      .select({ messageId: conversationMessages.id })
      .from(conversationMessages)
      .innerJoin(reports, eq(reports.id, conversationMessages.reportId))
      .innerJoin(analysisJobs, eq(analysisJobs.id, reports.jobId))
      .where(
        and(
          eq(conversationMessages.reportId, input.reportId),
          eq(conversationMessages.userId, input.userId),
          eq(conversationMessages.idempotencyKey, input.idempotencyKey),
          eq(reports.jobId, input.jobId),
          eq(reports.userId, input.userId),
          eq(analysisJobs.userId, input.userId),
        ),
      )
      .limit(1);
    return message ?? null;
  }

  async completeRevision(input: CompleteRevision): Promise<{ completed: boolean; revisionId?: string }> {
    return this.db.transaction(async (tx) => {
      const [message] = await tx
        .select({ target: conversationMessages.target })
        .from(conversationMessages)
        .innerJoin(reports, eq(reports.id, conversationMessages.reportId))
        .innerJoin(analysisJobs, eq(analysisJobs.id, reports.jobId))
        .where(
          and(
            eq(conversationMessages.id, input.messageId),
            eq(conversationMessages.reportId, input.reportId),
            eq(conversationMessages.userId, input.userId),
            eq(conversationMessages.role, "user"),
            eq(conversationMessages.status, "running"),
            eq(conversationMessages.leaseId, input.leaseId),
            gt(conversationMessages.leaseExpiresAt, input.now),
            eq(reports.id, input.reportId),
            eq(reports.jobId, input.jobId),
            eq(reports.userId, input.userId),
            eq(analysisJobs.userId, input.userId),
          ),
        )
        .for("update")
        .limit(1);
      if (!message) return { completed: false };
      if (
        input.module.moduleType !== message.target.moduleType ||
        !input.changes.length ||
        !input.changes.every((change) => hasSameTarget(change.target, message.target)) ||
        !input.changes.every((change) => reportRevisionChangeSchema.safeParse(change).success) ||
        !modulePayloadSchemas[input.module.moduleType].safeParse(input.module.payload).success
      ) {
        return { completed: false };
      }

      const [lockedReport] = await tx
        .select({ id: reports.id })
        .from(reports)
        .where(and(
          eq(reports.id, input.reportId),
          eq(reports.jobId, input.jobId),
          eq(reports.userId, input.userId),
          eq(reports.currentVersion, input.expectedReportVersion),
        ))
        .for("update")
        .limit(1);
      if (!lockedReport) {
        await this.markRevisionRecoverable(tx, input);
        return { completed: false };
      }

      const [currentModule] = await tx
        .select({ payload: reportModules.payload })
        .from(reportModules)
        .where(and(
          eq(reportModules.reportId, input.reportId),
          eq(reportModules.moduleType, input.module.moduleType),
          eq(reportModules.version, input.module.expectedVersion),
        ))
        .for("update")
        .limit(1);
      if (
        !currentModule
        || !isTargetScopedModuleReplacement(
          currentModule.payload as CompleteRevision["module"]["payload"],
          input.module.payload,
          message.target,
        )
      ) {
        return { completed: false };
      }

      const evidenceSourceIds = [
        ...new Set(input.changes.flatMap((change) => change.newEvidenceSourceIds)),
      ];
      const replacementSourceIds = reportModuleSourceIds(
        input.module.moduleType,
        input.module.payload,
      );
      if (evidenceSourceIds.length || replacementSourceIds.length) {
        const persistedSources = await tx
          .select({ sourceKey: reportSources.sourceKey })
          .from(reportSources)
          .where(eq(reportSources.reportId, input.reportId));
        const persistedSourceIds = new Set(
          persistedSources.map((source) => source.sourceKey),
        );
        if (
          !evidenceSourceIds.every((sourceId) => persistedSourceIds.has(sourceId))
          || !replacementSourceIds.every((sourceId) => persistedSourceIds.has(sourceId))
        ) {
          return { completed: false };
        }
      }

      const [report] = await tx
        .update(reports)
        .set({ currentVersion: input.expectedReportVersion + 1, updatedAt: input.now })
        .where(
          and(
            eq(reports.id, input.reportId),
            eq(reports.userId, input.userId),
            eq(reports.currentVersion, input.expectedReportVersion),
          ),
        )
        .returning({ id: reports.id });
      if (!report) {
        await this.markRevisionRecoverable(tx, input);
        return { completed: false };
      }

      if (input.module.moduleType === "sources") {
        await this.syncReportSources(
          tx,
          input.reportId,
          input.module.payload.sources,
          evidenceSourceIds,
        );
      }

      const [module] = await tx
        .update(reportModules)
        .set({
          status: "completed",
          errorCode: null,
          payload: input.module.payload,
          version: input.module.nextVersion,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(reportModules.reportId, input.reportId),
            eq(reportModules.moduleType, input.module.moduleType),
            eq(reportModules.version, input.module.expectedVersion),
          ),
        )
        .returning({ id: reportModules.id });
      if (!module) throw new Error("Report module version changed during revision");

      const [agentMessage] = await tx
        .insert(conversationMessages)
        .values({
          reportId: input.reportId,
          userId: input.userId,
          role: "agent",
          target: message.target,
          content: input.agentContent,
          status: "completed",
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning({ id: conversationMessages.id });
      await tx
        .update(conversationMessages)
        .set({
          status: "completed",
          leaseId: null,
          leaseExpiresAt: null,
          updatedAt: input.now,
        })
        .where(eq(conversationMessages.id, input.messageId));

      const [revision] = await tx
        .insert(reportRevisions)
        .values({
          reportId: input.reportId,
          triggeringMessageId: input.messageId,
          fromVersion: input.expectedReportVersion,
          toVersion: input.expectedReportVersion + 1,
          changes: input.changes,
          status: "completed",
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning({ id: reportRevisions.id });
      await tx.insert(analysisEvents).values({
        jobId: input.jobId,
        userId: input.userId,
        eventType: "report.revised",
        payload: {
          messageId: input.messageId,
          agentMessageId: agentMessage.id,
          revisionId: revision.id,
          moduleType: input.module.moduleType,
          fromVersion: input.expectedReportVersion,
          toVersion: input.expectedReportVersion + 1,
        },
        createdAt: input.now,
      });
      return { completed: true, revisionId: revision.id };
    });
  }

  async startRevision(input: StartRevision): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [message] = await tx
        .update(conversationMessages)
        .set({
          status: "running",
          leaseId: input.leaseId,
          leaseExpiresAt: input.leaseExpiresAt,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(conversationMessages.id, input.messageId),
            eq(conversationMessages.reportId, input.reportId),
            eq(conversationMessages.userId, input.userId),
            eq(conversationMessages.role, "user"),
            or(
              inArray(conversationMessages.status, ["queued", "recoverable"]),
              and(
                eq(conversationMessages.status, "running"),
                or(
                  isNull(conversationMessages.leaseExpiresAt),
                  lte(conversationMessages.leaseExpiresAt, input.now),
                ),
              ),
            ),
            this.ownedReportExists(tx, input),
          ),
        )
        .returning({ id: conversationMessages.id });
      if (!message) return false;

      await this.appendConversationEvent(tx, input, "running");
      return true;
    });
  }

  async completeRevisionResponse(input: CompleteRevisionResponse): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [message] = await tx
        .select({ target: conversationMessages.target })
        .from(conversationMessages)
        .innerJoin(reports, eq(reports.id, conversationMessages.reportId))
        .innerJoin(analysisJobs, eq(analysisJobs.id, reports.jobId))
        .where(
          and(
            eq(conversationMessages.id, input.messageId),
            eq(conversationMessages.reportId, input.reportId),
            eq(conversationMessages.userId, input.userId),
            eq(conversationMessages.role, "user"),
            eq(conversationMessages.status, "running"),
            eq(conversationMessages.leaseId, input.leaseId),
            gt(conversationMessages.leaseExpiresAt, input.now),
            eq(reports.id, input.reportId),
            eq(reports.jobId, input.jobId),
            eq(reports.userId, input.userId),
            eq(analysisJobs.userId, input.userId),
          ),
        )
        .for("update")
        .limit(1);
      if (!message) return false;

      const [report] = await tx
        .update(reports)
        .set({ currentVersion: input.expectedReportVersion })
        .where(
          and(
            eq(reports.id, input.reportId),
            eq(reports.jobId, input.jobId),
            eq(reports.userId, input.userId),
            eq(reports.currentVersion, input.expectedReportVersion),
          ),
        )
        .returning({ id: reports.id });
      if (!report) {
        await this.markRevisionRecoverable(tx, input);
        return false;
      }

      await tx
        .update(conversationMessages)
        .set({
          status: "completed",
          leaseId: null,
          leaseExpiresAt: null,
          updatedAt: input.now,
        })
        .where(eq(conversationMessages.id, input.messageId));
      const [agentMessage] = await tx
        .insert(conversationMessages)
        .values({
          reportId: input.reportId,
          userId: input.userId,
          role: "agent",
          target: message.target,
          content: input.agentContent,
          status: "completed",
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning({ id: conversationMessages.id });
      await tx.insert(analysisEvents).values({
        jobId: input.jobId,
        userId: input.userId,
        eventType: "conversation.updated",
        payload: {
          messageId: input.messageId,
          agentMessageId: agentMessage.id,
          status: "completed",
        },
        createdAt: input.now,
      });
      return true;
    });
  }

  async recoverRevision(input: RecoverRevision): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const updated = await this.markRevisionRecoverable(tx, input);
      return Boolean(updated);
    });
  }

  private async markRevisionRecoverable(
    tx: Parameters<AppDb["transaction"]>[0] extends (tx: infer Transaction) => unknown
      ? Transaction
      : never,
    input: RecoverRevision,
  ): Promise<boolean> {
    return this.transitionRevisionMessage(
      tx,
      input,
      ["running"],
      "recoverable",
    );
  }

  private async transitionRevisionMessage(
    tx: Parameters<AppDb["transaction"]>[0] extends (tx: infer Transaction) => unknown
      ? Transaction
      : never,
    input: RecoverRevision,
    from: Array<ConversationMessage["status"]>,
    to: ConversationMessage["status"],
  ): Promise<boolean> {
    const [message] = await tx
      .update(conversationMessages)
      .set({
        status: to,
        leaseId: null,
        leaseExpiresAt: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(conversationMessages.id, input.messageId),
          eq(conversationMessages.reportId, input.reportId),
          eq(conversationMessages.userId, input.userId),
          eq(conversationMessages.role, "user"),
          eq(conversationMessages.leaseId, input.leaseId),
          inArray(conversationMessages.status, from),
          exists(
            tx
              .select({ reportId: reports.id })
              .from(reports)
              .innerJoin(analysisJobs, eq(analysisJobs.id, reports.jobId))
              .where(
                and(
                  eq(reports.id, input.reportId),
                  eq(reports.jobId, input.jobId),
                  eq(reports.userId, input.userId),
                  eq(analysisJobs.userId, input.userId),
                ),
              ),
          ),
        ),
      )
      .returning({ id: conversationMessages.id });
    if (!message) return false;

    await tx.insert(analysisEvents).values({
      jobId: input.jobId,
      userId: input.userId,
      eventType: "conversation.updated",
      payload: { messageId: input.messageId, status: to },
      createdAt: input.now,
    });
    return true;
  }

  private ownedReportExists(
    tx: Parameters<AppDb["transaction"]>[0] extends (tx: infer Transaction) => unknown
      ? Transaction
      : never,
    input: Pick<RecoverRevision, "jobId" | "reportId" | "userId">,
  ) {
    return exists(
      tx
        .select({ reportId: reports.id })
        .from(reports)
        .innerJoin(analysisJobs, eq(analysisJobs.id, reports.jobId))
        .where(
          and(
            eq(reports.id, input.reportId),
            eq(reports.jobId, input.jobId),
            eq(reports.userId, input.userId),
            eq(analysisJobs.userId, input.userId),
          ),
        ),
    );
  }

  private async appendConversationEvent(
    tx: Parameters<AppDb["transaction"]>[0] extends (tx: infer Transaction) => unknown
      ? Transaction
      : never,
    input: Pick<RecoverRevision, "jobId" | "messageId" | "userId" | "now">,
    status: ConversationMessage["status"],
  ): Promise<void> {
    await tx.insert(analysisEvents).values({
      jobId: input.jobId,
      userId: input.userId,
      eventType: "conversation.updated",
      payload: { messageId: input.messageId, status },
      createdAt: input.now,
    });
  }

  async getJobForExecution(jobId: string): Promise<ExecutionJob | null> {
    const [job] = await this.db
      .select({
        jobId: analysisJobs.id,
        userId: analysisJobs.userId,
        reportId: reports.id,
        material: analysisMaterials.content,
        detectedLanguage: analysisMaterials.detectedLanguage,
        status: analysisJobs.status,
        configVersion: analysisJobs.configVersion,
      })
      .from(analysisJobs)
      .innerJoin(analysisMaterials, eq(analysisMaterials.id, analysisJobs.materialId))
      .innerJoin(reports, eq(reports.jobId, analysisJobs.id))
      .where(eq(analysisJobs.id, jobId))
      .limit(1);

    return job
      ? {
          ...job,
          status: asJobStatus(job.status),
          detectedLanguage: job.detectedLanguage as ExecutionJob["detectedLanguage"],
        }
      : null;
  }

  async getOwnedSnapshot(userId: string, jobId: string): Promise<AnalysisSnapshot | null> {
    return this.db.transaction(async (tx) => {
      const [job] = await tx
        .select({
          jobId: analysisJobs.id,
          status: analysisJobs.status,
          configVersion: analysisJobs.configVersion,
          materialPreview: analysisMaterials.content,
          createdAt: analysisJobs.createdAt,
          updatedAt: analysisJobs.updatedAt,
          reportId: reports.id,
          currentVersion: reports.currentVersion,
        })
        .from(analysisJobs)
        .innerJoin(analysisMaterials, eq(analysisMaterials.id, analysisJobs.materialId))
        .innerJoin(reports, eq(reports.jobId, analysisJobs.id))
        .where(and(eq(analysisJobs.id, jobId), eq(analysisJobs.userId, userId)))
        .limit(1);
      if (!job) return null;

      const [modules, messages, revisions, [lastEvent]] = await Promise.all([
        tx.select().from(reportModules).where(eq(reportModules.reportId, job.reportId)),
        tx
          .select()
          .from(conversationMessages)
          .where(
            and(
              eq(conversationMessages.reportId, job.reportId),
              eq(conversationMessages.userId, userId),
            ),
          )
          .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id)),
        tx
          .select()
          .from(reportRevisions)
          .where(eq(reportRevisions.reportId, job.reportId))
          .orderBy(asc(reportRevisions.createdAt), asc(reportRevisions.id)),
        tx
          .select({ id: analysisEvents.id })
          .from(analysisEvents)
          .where(and(eq(analysisEvents.jobId, jobId), eq(analysisEvents.userId, userId)))
          .orderBy(desc(analysisEvents.id))
          .limit(1),
      ]);

      const moduleMap = Object.fromEntries(
        modules.map((module) => [
          module.moduleType,
          {
            status: asModuleStatus(module.status),
            version: module.version,
            ...(module.errorCode ? { errorCode: module.errorCode } : {}),
            ...(Object.keys(module.payload).length ? { payload: module.payload } : {}),
          },
        ]),
      ) as AnalysisSnapshot["modules"];

      return {
        jobId: job.jobId,
        reportId: job.reportId,
        currentVersion: job.currentVersion,
        status: asJobStatus(job.status),
        configVersion: job.configVersion,
        materialPreview: job.materialPreview.slice(0, 80),
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
        lastEventId: lastEvent?.id ?? 0,
        messages: messages.map((message) => ({
          id: message.id,
          reportId: message.reportId,
          role: message.role as ConversationMessage["role"],
          target: message.target,
          content: message.content,
          status: message.status as ConversationMessage["status"],
          idempotencyKey: message.idempotencyKey,
          createdAt: message.createdAt.toISOString(),
        })),
        revisions: revisions.map((revision) => ({
          id: revision.id,
          triggeringMessageId: revision.triggeringMessageId,
          fromVersion: revision.fromVersion,
          toVersion: revision.toVersion,
          changes: revision.changes,
          status: revision.status as ReportRevision["status"],
          createdAt: revision.createdAt.toISOString(),
        })),
        modules: moduleMap,
      };
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }

  async listOwnedHistory(userId: string, limit: number, before?: Date): Promise<HistoryItem[]> {
    const items = await this.db
      .select({
        jobId: analysisJobs.id,
        status: analysisJobs.status,
        materialPreview: analysisMaterials.content,
        createdAt: analysisJobs.createdAt,
        completedModuleCount: sql<number>`count(*) filter (where ${reportModules.status} = 'completed')`,
      })
      .from(analysisJobs)
      .innerJoin(analysisMaterials, eq(analysisMaterials.id, analysisJobs.materialId))
      .innerJoin(reports, eq(reports.jobId, analysisJobs.id))
      .leftJoin(reportModules, eq(reportModules.reportId, reports.id))
      .where(
        before
          ? and(eq(analysisJobs.userId, userId), lt(analysisJobs.createdAt, before))
          : eq(analysisJobs.userId, userId),
      )
      .groupBy(analysisJobs.id, analysisMaterials.content)
      .orderBy(desc(analysisJobs.createdAt))
      .limit(limit);

    return items.map((item) => ({
      jobId: item.jobId,
      status: asJobStatus(item.status),
      materialPreview: item.materialPreview.slice(0, 80),
      createdAt: item.createdAt.toISOString(),
      completedModuleCount: Number(item.completedModuleCount),
    }));
  }

  async transitionJob(
    jobId: string,
    from: AnalysisJobStatus[],
    to: AnalysisJobStatus,
    fields?: { triggerRunId?: string | null; failureCode?: string | null; now?: Date },
  ): Promise<boolean> {
    if (!from.length) return false;
    const now = fields?.now ?? new Date();
    const [updated] = await this.db
      .update(analysisJobs)
      .set({
        status: to,
        updatedAt: now,
        ...(to === "running" ? { startedAt: now } : {}),
        ...(to === "completed" ? { completedAt: now } : {}),
        ...(fields?.triggerRunId !== undefined ? { triggerRunId: fields.triggerRunId } : {}),
        ...(fields?.failureCode !== undefined ? { failureCode: fields.failureCode } : {}),
      })
      .where(and(eq(analysisJobs.id, jobId), inArray(analysisJobs.status, from)))
      .returning({ id: analysisJobs.id });
    return Boolean(updated);
  }

  async startExpertRun(input: StartExpertRun): Promise<string> {
    const [run] = await this.db
      .insert(expertRuns)
      .values({
        ...input,
        status: "running",
        createdAt: input.now,
        startedAt: input.now,
        updatedAt: input.now,
      })
      .returning({ id: expertRuns.id });
    return run.id;
  }

  async finishExpertRun(input: FinishExpertRun): Promise<void> {
    await this.db
      .update(expertRuns)
      .set({
        status: input.status,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        estimatedCostUsd: input.estimatedCostUsd,
        latencyMs: input.latencyMs,
        errorCode: input.errorCode ?? null,
        completedAt: input.now,
        updatedAt: input.now,
      })
      .where(eq(expertRuns.id, input.id));
  }

  async saveModule(input: SaveModule): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(reportModules)
        .set({
          status: input.status,
          errorCode: input.errorCode ?? null,
          version: input.nextVersion,
          updatedAt: input.now,
          ...(input.payload !== undefined ? { payload: input.payload as Record<string, unknown> } : {}),
        })
        .where(
          and(
            eq(reportModules.reportId, input.reportId),
            eq(reportModules.moduleType, input.moduleType),
            eq(reportModules.version, input.expectedVersion),
            exists(
              tx
                .select({ reportId: reports.id })
                .from(reports)
                .innerJoin(analysisJobs, eq(analysisJobs.id, reports.jobId))
                .where(
                  and(
                    eq(reports.id, input.reportId),
                    eq(reports.jobId, input.jobId),
                    eq(reports.userId, input.userId),
                    eq(analysisJobs.userId, input.userId),
                  ),
                ),
            ),
          ),
        )
        .returning({ id: reportModules.id });
      if (!updated) return;

      await tx.insert(analysisEvents).values({
        jobId: input.jobId,
        userId: input.userId,
        eventType: "module.updated",
        payload: {
          moduleType: input.moduleType,
          status: input.status,
          version: input.nextVersion,
          errorCode: input.errorCode ?? null,
        },
        createdAt: input.now,
      });
    });
  }

  async replaceSources(reportId: string, sources: Parameters<AnalysisRepository["replaceSources"]>[1]): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [report] = await tx
        .select({ id: reports.id })
        .from(reports)
        .where(eq(reports.id, reportId))
        .for("update")
        .limit(1);
      if (!report) return;

      await this.syncReportSources(tx, reportId, sources);
    });
  }

  private async syncReportSources(
    tx: Parameters<AppDb["transaction"]>[0] extends (tx: infer Transaction) => unknown
      ? Transaction
      : never,
    reportId: string,
    sources: Parameters<AnalysisRepository["replaceSources"]>[1],
    additionalPreservedSourceIds: readonly string[] = [],
  ): Promise<void> {
    const revisions = await tx
      .select({ changes: reportRevisions.changes })
      .from(reportRevisions)
      .where(eq(reportRevisions.reportId, reportId));
    const uniqueSources = [...new Map(sources.map((source) => [source.id, source])).values()];
    const currentSourceIds = uniqueSources.map((source) => source.id);
    const preservedSourceIds = revisions.flatMap((revision) =>
      revision.changes.flatMap((change) => change.newEvidenceSourceIds)
    );
    const retainedSourceIds = [
      ...new Set([...currentSourceIds, ...preservedSourceIds, ...additionalPreservedSourceIds]),
    ];

    await tx
      .delete(reportSources)
      .where(
        retainedSourceIds.length
          ? and(
              eq(reportSources.reportId, reportId),
              notInArray(reportSources.sourceKey, retainedSourceIds),
            )
          : eq(reportSources.reportId, reportId),
      );
    if (!uniqueSources.length) return;

    await tx.delete(reportSources).where(and(
      eq(reportSources.reportId, reportId),
      inArray(reportSources.sourceKey, currentSourceIds),
    ));
    await tx.insert(reportSources).values(
      uniqueSources.map((source) => ({
        reportId,
        sourceKey: source.id,
        title: source.title,
        url: source.url,
        canonicalUrl: source.url,
        domain: source.domain,
        publisher: source.publisher,
        publishedAt: source.publishedAt ? new Date(source.publishedAt) : null,
        qualityTier: String(source.qualityTier),
        excerpt: source.excerpt,
      })),
    );
  }

  async appendEvent(input: NewAnalysisEvent): Promise<number> {
    const [event] = await this.db
      .insert(analysisEvents)
      .values({
        jobId: input.jobId,
        userId: input.userId,
        eventType: input.eventType,
        payload: input.payload,
        createdAt: input.now,
      })
      .returning({ id: analysisEvents.id });
    return event.id;
  }

  async listEvents(userId: string, jobId: string, afterId: number, limit: number): Promise<AnalysisEvent[]> {
    const events = await this.db
      .select()
      .from(analysisEvents)
      .where(
        and(
          eq(analysisEvents.userId, userId),
          eq(analysisEvents.jobId, jobId),
          gt(analysisEvents.id, afterId),
        ),
      )
      .orderBy(analysisEvents.id)
      .limit(limit);

    return events.map((event) => ({
      id: event.id,
      jobId: event.jobId,
      userId: event.userId,
      eventType: event.eventType as AnalysisEvent["eventType"],
      payload: event.payload as AnalysisEvent["payload"],
      createdAt: event.createdAt.toISOString(),
    }));
  }
}
