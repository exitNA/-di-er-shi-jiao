import { and, desc, eq, exists, gt, inArray, lt, sql } from "drizzle-orm";
import type {
  AnalysisJobStatus,
  AnalysisSnapshot,
  ReportModuleStatus,
  ReportModuleType,
} from "@/features/analysis/domain/contracts";
import { moduleTypes } from "@/features/analysis/domain/contracts";
import type { AppDb } from "@/server/db/client";
import {
  analysisEvents,
  analysisJobs,
  analysisMaterials,
  expertRuns,
  reportModules,
  reports,
  reportSources,
} from "@/server/db/schema/analysis";
import type {
  AnalysisEvent,
  AnalysisRepository,
  ExecutionJob,
  FinishExpertRun,
  HistoryItem,
  NewAnalysis,
  NewAnalysisEvent,
  SaveModule,
  StartExpertRun,
} from "./analysis-repository";

function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function asJobStatus(status: string): AnalysisJobStatus {
  return status as AnalysisJobStatus;
}

function asModuleStatus(status: string): ReportModuleStatus {
  return status as ReportModuleStatus;
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
      if (!isUniqueViolation(error)) throw error;

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
        })
        .from(analysisJobs)
        .innerJoin(analysisMaterials, eq(analysisMaterials.id, analysisJobs.materialId))
        .innerJoin(reports, eq(reports.jobId, analysisJobs.id))
        .where(and(eq(analysisJobs.id, jobId), eq(analysisJobs.userId, userId)))
        .limit(1);
      if (!job) return null;

      const [modules, [lastEvent]] = await Promise.all([
        tx.select().from(reportModules).where(eq(reportModules.reportId, job.reportId)),
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
        status: asJobStatus(job.status),
        configVersion: job.configVersion,
        materialPreview: job.materialPreview.slice(0, 80),
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
        lastEventId: lastEvent?.id ?? 0,
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
      await tx.delete(reportSources).where(eq(reportSources.reportId, reportId));
      const uniqueSources = [...new Map(sources.map((source) => [source.id, source])).values()];
      if (!uniqueSources.length) return;
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
    });
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
