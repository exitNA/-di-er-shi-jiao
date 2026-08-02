import { and, asc, desc, eq, exists, gt, inArray, isNull, lt, lte, notInArray, or, sql } from "drizzle-orm";
import type {
  AnalysisJobStatus,
  AnalysisSnapshot,
  BaselineDraft,
  ConversationMessage,
  ReportRevision,
  ReportModuleType,
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
  agentRuns,
  agentToolCalls,
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
  ClaimAgentRun,
  ChallengeAgentRunResult,
  CompleteChallengeToolCall,
  CompleteRevisionResponse,
  CompleteRevision,
  ExecutionJob,
  FinishAgentRun,
  FinishAgentToolCall,
  FindAgentToolArtifact,
  FinishExpertRun,
  HistoryItem,
  NewAgentRun,
  NewChallengeAgentRun,
  NewAgentToolCall,
  NewChallenge,
  NewAnalysis,
  NewAnalysisEvent,
  RecoverRevision,
  RequestAgentRunCancellation,
  SaveAgentToolArtifact,
  SaveModule,
  SaveRevisionDraft,
  StartExpertRun,
  StartRevision,
} from "./analysis-repository";
import {
  safeAgentSummarySchema,
  workspaceToolArtifactSchema,
  type WorkspaceAgentRun,
  type WorkspaceRunStatus,
  type WorkspaceToolArtifact,
  type WorkspaceToolCall,
} from "@/features/analysis/domain/workspace";

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

  async createChallengeAgentRun(
    input: NewChallengeAgentRun,
  ): Promise<ChallengeAgentRunResult | { code: "RUN_BUSY" } | null> {
    return this.db.transaction(async (tx) => {
      const [workspace] = await tx
        .select({ reportId: reports.id, status: analysisJobs.status })
        .from(analysisJobs)
        .innerJoin(reports, eq(reports.jobId, analysisJobs.id))
        .where(and(
          eq(analysisJobs.id, input.jobId),
          eq(analysisJobs.userId, input.userId),
          eq(reports.id, input.reportId),
          eq(reports.userId, input.userId),
        ))
        .for("update")
        .limit(1);
      if (!workspace) return null;

      const [existingMessage] = await tx
        .select({
          id: conversationMessages.id,
          status: conversationMessages.status,
        })
        .from(conversationMessages)
        .where(and(
          eq(conversationMessages.reportId, input.reportId),
          eq(conversationMessages.userId, input.userId),
          eq(conversationMessages.idempotencyKey, input.idempotencyKey),
        ))
        .limit(1);
      const [latestRun] = await tx
        .select({
          id: agentRuns.id,
          status: agentRuns.status,
          createdAt: agentRuns.createdAt,
        })
        .from(agentRuns)
        .where(eq(agentRuns.jobId, input.jobId))
        .orderBy(desc(agentRuns.createdAt), desc(agentRuns.id))
        .limit(1);
      const activeRun = latestRun
        && (latestRun.status === "queued" || latestRun.status === "running")
        ? latestRun
        : undefined;

      if (existingMessage) {
        const [existingRun] = await tx
          .select({
            id: agentRuns.id,
            status: agentRuns.status,
            createdAt: agentRuns.createdAt,
          })
          .from(agentRuns)
          .where(and(
            eq(agentRuns.jobId, input.jobId),
            eq(agentRuns.messageId, existingMessage.id),
          ))
          .orderBy(desc(agentRuns.createdAt), desc(agentRuns.id))
          .limit(1);
        if (
          existingRun
          && (existingRun.status === "queued" || existingRun.status === "running")
        ) {
          if (activeRun?.id !== existingRun.id) return { code: "RUN_BUSY" as const };
          return {
            messageId: existingMessage.id,
            agentRunId: existingRun.id,
            created: false,
            status: existingRun.status,
            shouldEnqueue: existingRun.status === "queued",
          };
        }
        if (existingMessage.status === "completed" && existingRun) {
          return {
            messageId: existingMessage.id,
            agentRunId: existingRun.id,
            created: false,
            status: "completed",
            shouldEnqueue: false,
          };
        }
        if (activeRun) return { code: "RUN_BUSY" as const };

        let runNow = input.now;
        if (existingRun && runNow <= existingRun.createdAt) {
          runNow = new Date(existingRun.createdAt.getTime() + 1);
        }
        if (latestRun && runNow <= latestRun.createdAt) {
          runNow = new Date(latestRun.createdAt.getTime() + 1);
        }
        await tx
          .update(conversationMessages)
          .set({
            status: "queued",
            leaseId: null,
            leaseExpiresAt: null,
            updatedAt: input.now,
          })
          .where(eq(conversationMessages.id, existingMessage.id));
        const [run] = await tx
          .insert(agentRuns)
          .values({
            jobId: input.jobId,
            messageId: existingMessage.id,
            kind: "challenge",
            status: "queued",
            configVersion: input.configVersion,
            createdAt: runNow,
            updatedAt: runNow,
          })
          .returning({ id: agentRuns.id });
        return {
          messageId: existingMessage.id,
          agentRunId: run.id,
          created: false,
          status: "queued",
          shouldEnqueue: true,
        };
      }

      if (workspace.status !== "completed") return { code: "RUN_BUSY" as const };
      if (activeRun) return { code: "RUN_BUSY" as const };
      const runNow = latestRun && input.now <= latestRun.createdAt
        ? new Date(latestRun.createdAt.getTime() + 1)
        : input.now;
      const [message] = await tx
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
      const [run] = await tx
        .insert(agentRuns)
        .values({
          jobId: input.jobId,
          messageId: message.id,
          kind: "challenge",
          status: "queued",
          configVersion: input.configVersion,
          createdAt: runNow,
          updatedAt: runNow,
        })
        .returning({ id: agentRuns.id });
      return {
        messageId: message.id,
        agentRunId: run.id,
        created: true,
        status: "queued",
        shouldEnqueue: true,
      };
    });
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
      const toolCall = input.toolCall;
      if (
        toolCall
        && (
          !await this.lockOwnedWorkspace(tx, { workspaceId: input.jobId, userId: input.userId })
          || !await this.lockChallengeToolCall(tx, { ...input, toolCall })
        )
      ) return { completed: false };
      const [message] = await tx
        .select({
          target: conversationMessages.target,
          createdAt: conversationMessages.createdAt,
        })
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
      const agentCreatedAt = new Date(Math.max(
        input.now.getTime(),
        message.createdAt.getTime() + 1,
      ));
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
          createdAt: agentCreatedAt,
          updatedAt: agentCreatedAt,
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
      await this.finishChallengeToolCall(tx, input);
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
      const toolCall = input.toolCall;
      if (
        toolCall
        && (
          !await this.lockOwnedWorkspace(tx, { workspaceId: input.jobId, userId: input.userId })
          || !await this.lockChallengeToolCall(tx, { ...input, toolCall })
        )
      ) return false;
      const [message] = await tx
        .select({
          target: conversationMessages.target,
          createdAt: conversationMessages.createdAt,
        })
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
      if (!hasSameTarget(message.target, input.target)) return false;
      const agentCreatedAt = new Date(Math.max(
        input.now.getTime(),
        message.createdAt.getTime() + 1,
      ));

      const [targetModule] = await tx
        .select({ payload: reportModules.payload })
        .from(reportModules)
        .where(and(
          eq(reportModules.reportId, input.reportId),
          eq(reportModules.moduleType, input.target.moduleType),
          eq(reportModules.version, input.expectedModuleVersion),
        ))
        .for("update")
        .limit(1);
      if (
        !targetModule
        || !isTargetScopedModuleReplacement(
          targetModule.payload as BaselineDraft[ReportModuleType],
          targetModule.payload as BaselineDraft[ReportModuleType],
          input.target,
        )
      ) return false;

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
          createdAt: agentCreatedAt,
          updatedAt: agentCreatedAt,
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
      await this.finishChallengeToolCall(tx, input);
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

  private async lockOwnedWorkspace(
    tx: Parameters<AppDb["transaction"]>[0] extends (tx: infer Transaction) => unknown
      ? Transaction
      : never,
    input: { workspaceId: string; userId: string },
  ): Promise<boolean> {
    const [workspace] = await tx
      .select({ id: analysisJobs.id })
      .from(analysisJobs)
      .where(and(eq(analysisJobs.id, input.workspaceId), eq(analysisJobs.userId, input.userId)))
      .for("update")
      .limit(1);
    return Boolean(workspace);
  }

  private async isCurrentRunningAgentRun(
    tx: Parameters<AppDb["transaction"]>[0] extends (tx: infer Transaction) => unknown
      ? Transaction
      : never,
    input: { workspaceId: string; userId: string; agentRunId?: string },
  ): Promise<boolean> {
    if (!input.agentRunId) return true;
    if (!await this.lockOwnedWorkspace(tx, input)) return false;

    const [latestRun] = await tx
      .select({ id: agentRuns.id, status: agentRuns.status })
      .from(agentRuns)
      .where(eq(agentRuns.jobId, input.workspaceId))
      .orderBy(desc(agentRuns.createdAt), desc(agentRuns.id))
      .for("update")
      .limit(1);
    return latestRun?.id === input.agentRunId && latestRun.status === "running";
  }

  private ownedAgentToolCallExists(
    tx: Parameters<AppDb["transaction"]>[0] extends (tx: infer Transaction) => unknown
      ? Transaction
      : never,
    input: Pick<FinishAgentToolCall, "workspaceId" | "userId" | "agentRunId" | "id">,
  ) {
    return exists(
      tx
        .select({ id: agentToolCalls.id })
        .from(agentToolCalls)
        .innerJoin(agentRuns, eq(agentRuns.id, agentToolCalls.agentRunId))
        .innerJoin(analysisJobs, eq(analysisJobs.id, agentRuns.jobId))
        .where(
          and(
            eq(agentToolCalls.id, input.id),
            eq(agentToolCalls.agentRunId, input.agentRunId),
            eq(agentRuns.jobId, input.workspaceId),
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

  private async lockChallengeToolCall(
    tx: Parameters<AppDb["transaction"]>[0] extends (tx: infer Transaction) => unknown
      ? Transaction
      : never,
    input: {
      jobId: string;
      userId: string;
      messageId: string;
      toolCall: CompleteChallengeToolCall;
    },
  ): Promise<boolean> {
    const [call] = await tx
      .select({ id: agentToolCalls.id })
      .from(agentToolCalls)
      .innerJoin(agentRuns, eq(agentRuns.id, agentToolCalls.agentRunId))
      .innerJoin(analysisJobs, eq(analysisJobs.id, agentRuns.jobId))
      .where(and(
        eq(agentToolCalls.id, input.toolCall.id),
        eq(agentToolCalls.agentRunId, input.toolCall.agentRunId),
        eq(agentToolCalls.toolName, "review_target"),
        eq(agentToolCalls.status, "running"),
        eq(agentRuns.jobId, input.jobId),
        eq(agentRuns.messageId, input.messageId),
        eq(agentRuns.kind, "challenge"),
        eq(agentRuns.status, "running"),
        eq(analysisJobs.userId, input.userId),
      ))
      .for("update")
      .limit(1);
    return Boolean(call);
  }

  private async finishChallengeToolCall(
    tx: Parameters<AppDb["transaction"]>[0] extends (tx: infer Transaction) => unknown
      ? Transaction
      : never,
    input: {
      jobId: string;
      userId: string;
      toolCall?: CompleteChallengeToolCall;
      now: Date;
    },
  ): Promise<void> {
    if (!input.toolCall) return;
    const summary = safeAgentSummarySchema.parse(input.toolCall.summary);
    const [finished] = await tx
      .update(agentToolCalls)
      .set({
        status: "completed",
        summary,
        errorCode: null,
        completedAt: input.now,
      })
      .where(and(
        eq(agentToolCalls.id, input.toolCall.id),
        eq(agentToolCalls.agentRunId, input.toolCall.agentRunId),
        eq(agentToolCalls.status, "running"),
      ))
      .returning({ id: agentToolCalls.id });
    if (!finished) throw new Error("Challenge tool call state changed");
    const [run] = await tx
      .update(agentRuns)
      .set({ status: "completed", completedAt: input.now, updatedAt: input.now })
      .where(and(
        eq(agentRuns.id, input.toolCall.agentRunId),
        eq(agentRuns.jobId, input.jobId),
        eq(agentRuns.kind, "challenge"),
        eq(agentRuns.status, "running"),
      ))
      .returning({ id: agentRuns.id });
    if (!run) throw new Error("Challenge Agent run state changed");
    const [workspace] = await tx
      .update(analysisJobs)
      .set({ status: "completed", completedAt: input.now, updatedAt: input.now })
      .where(and(
        eq(analysisJobs.id, input.jobId),
        eq(analysisJobs.userId, input.userId),
        eq(analysisJobs.status, "running"),
      ))
      .returning({ id: analysisJobs.id });
    if (!workspace) throw new Error("Challenge workspace state changed");
    await this.appendToolCallEvent(tx, {
      workspaceId: input.jobId,
      userId: input.userId,
      agentRunId: input.toolCall.agentRunId,
      toolCallId: input.toolCall.id,
      status: "completed",
      now: input.now,
    });
    await tx.insert(analysisEvents).values({
      jobId: input.jobId,
      userId: input.userId,
      eventType: "agent.run.completed",
      payload: { agentRunId: input.toolCall.agentRunId },
      createdAt: input.now,
    });
  }

  private async appendToolCallEvent(
    tx: Parameters<AppDb["transaction"]>[0] extends (tx: infer Transaction) => unknown
      ? Transaction
      : never,
    input: {
      workspaceId: string;
      userId: string;
      agentRunId: string;
      toolCallId: string;
      status: "running" | "completed" | "recoverable";
      now: Date;
    },
  ): Promise<void> {
    await tx.insert(analysisEvents).values({
      jobId: input.workspaceId,
      userId: input.userId,
      eventType: "agent.tool.updated",
      payload: {
        agentRunId: input.agentRunId,
        toolCallId: input.toolCallId,
        status: input.status,
      },
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
          workspaceId: analysisJobs.id,
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

      const modules = await tx
        .select()
        .from(reportModules)
        .where(eq(reportModules.reportId, job.reportId));
      const messages = await tx
        .select()
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.reportId, job.reportId),
            eq(conversationMessages.userId, userId),
          ),
        )
        .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id));
      const revisions = await tx
        .select()
        .from(reportRevisions)
        .where(eq(reportRevisions.reportId, job.reportId))
        .orderBy(asc(reportRevisions.createdAt), asc(reportRevisions.id));
      const [activeRun] = await tx
        .select()
        .from(agentRuns)
        .where(eq(agentRuns.jobId, job.workspaceId))
        .orderBy(desc(agentRuns.createdAt), desc(agentRuns.id))
        .limit(1);
      const [lastEvent] = await tx
        .select({ id: analysisEvents.id })
        .from(analysisEvents)
        .where(and(eq(analysisEvents.jobId, jobId), eq(analysisEvents.userId, userId)))
        .orderBy(desc(analysisEvents.id))
        .limit(1);
      const toolCalls = await tx
        .select()
        .from(agentToolCalls)
        .where(inArray(
          agentToolCalls.agentRunId,
          tx
            .select({ id: agentRuns.id })
            .from(agentRuns)
            .where(eq(agentRuns.jobId, job.workspaceId)),
        ))
        .orderBy(asc(agentToolCalls.createdAt), asc(agentToolCalls.id));

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
        workspaceId: job.workspaceId,
        reportId: job.reportId,
        currentVersion: job.currentVersion,
        status: asJobStatus(job.status),
        configVersion: job.configVersion,
        materialPreview: job.materialPreview.slice(0, 80),
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
        lastEventId: lastEvent?.id ?? 0,
        activeRun: activeRun ? {
          id: activeRun.id,
          workspaceId: job.workspaceId,
          kind: activeRun.kind as WorkspaceAgentRun["kind"],
          status: activeRun.status as WorkspaceRunStatus,
          configVersion: activeRun.configVersion,
          messageId: activeRun.messageId,
          cancellationRequestedAt: activeRun.cancellationRequestedAt?.toISOString() ?? null,
          startedAt: activeRun.startedAt?.toISOString() ?? null,
          completedAt: activeRun.completedAt?.toISOString() ?? null,
        } : null,
        toolCalls: toolCalls.map((call) => ({
          id: call.id,
          agentRunId: call.agentRunId,
          toolName: call.toolName,
          status: call.status as WorkspaceToolCall["status"],
          summary: call.summary,
          errorCode: call.errorCode,
          createdAt: call.createdAt.toISOString(),
          completedAt: call.completedAt?.toISOString() ?? null,
        })),
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

  async createAgentRun(input: NewAgentRun): Promise<{ id: string } | null> {
    return this.db.transaction(async (tx) => {
      const [workspace] = await tx
        .select({ id: analysisJobs.id })
        .from(analysisJobs)
        .where(and(eq(analysisJobs.id, input.workspaceId), eq(analysisJobs.userId, input.userId)))
        .for("update")
        .limit(1);
      if (!workspace) return null;

      if (input.kind === "challenge") {
        const [message] = await tx
          .select({ id: conversationMessages.id })
          .from(conversationMessages)
          .innerJoin(reports, eq(reports.id, conversationMessages.reportId))
          .where(and(
            eq(conversationMessages.id, input.messageId),
            eq(conversationMessages.userId, input.userId),
            eq(conversationMessages.role, "user"),
            eq(reports.jobId, input.workspaceId),
            eq(reports.userId, input.userId),
          ))
          .for("update")
          .limit(1);
        if (!message) return null;

        if (!input.previousAgentRunId) {
          const [existing] = await tx
            .select({ id: agentRuns.id })
            .from(agentRuns)
            .where(and(
              eq(agentRuns.jobId, input.workspaceId),
              eq(agentRuns.messageId, input.messageId),
            ))
            .orderBy(asc(agentRuns.createdAt), asc(agentRuns.id))
            .limit(1);
          if (existing) return existing;
        }
      }

      const [activeRun] = await tx
        .select({ id: agentRuns.id })
        .from(agentRuns)
        .where(and(
          eq(agentRuns.jobId, input.workspaceId),
          inArray(agentRuns.status, ["queued", "running"]),
        ))
        .limit(1);
      if (activeRun) return null;

      let runNow = input.now;
      if (input.previousAgentRunId) {
        const [previous] = await tx
          .select({
            id: agentRuns.id,
            status: agentRuns.status,
            messageId: agentRuns.messageId,
            createdAt: agentRuns.createdAt,
          })
          .from(agentRuns)
          .where(eq(agentRuns.jobId, input.workspaceId))
          .orderBy(desc(agentRuns.createdAt), desc(agentRuns.id))
          .limit(1);
        if (
          previous?.id !== input.previousAgentRunId
          || (previous.status !== "interrupted" && previous.status !== "recoverable")
          || (input.kind === "challenge" && previous.messageId !== input.messageId)
        ) {
          return null;
        }
        if (runNow <= previous.createdAt) {
          runNow = new Date(previous.createdAt.getTime() + 1);
        }
      }

      const [run] = await tx
        .insert(agentRuns)
        .values({
          jobId: input.workspaceId,
          messageId: input.kind === "challenge" ? input.messageId : null,
          kind: input.kind,
          status: "queued",
          configVersion: input.configVersion,
          createdAt: runNow,
          updatedAt: runNow,
        })
        .returning({ id: agentRuns.id });
      return run;
    });
  }

  async claimAgentRun(input: ClaimAgentRun): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      if (!await this.lockOwnedWorkspace(tx, input)) return false;

      const [claimed] = await tx
        .update(agentRuns)
        .set({
          status: "running",
          ...(input.triggerRunId !== undefined ? { triggerRunId: input.triggerRunId } : {}),
          startedAt: input.now,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(agentRuns.id, input.agentRunId),
            eq(agentRuns.jobId, input.workspaceId),
            eq(agentRuns.status, "queued"),
          ),
        )
        .returning({ id: agentRuns.id, kind: agentRuns.kind });
      if (!claimed) return false;

      const [workspace] = await tx
        .update(analysisJobs)
        .set({ status: "running", startedAt: input.now, updatedAt: input.now })
        .where(
          and(
            eq(analysisJobs.id, input.workspaceId),
            eq(analysisJobs.userId, input.userId),
            inArray(
              analysisJobs.status,
              claimed.kind === "challenge"
                ? ["queued", "running", "interrupted", "partial", "recoverable", "completed"]
                : ["queued", "interrupted", "partial", "recoverable"],
            ),
          ),
        )
        .returning({ id: analysisJobs.id });
      if (!workspace) throw new Error("Agent run workspace state changed");
      return true;
    });
  }

  async requestAgentRunCancellation(
    input: RequestAgentRunCancellation,
  ): Promise<{ triggerRunId: string | null; eventId: number } | null> {
    return this.db.transaction(async (tx) => {
      if (!await this.lockOwnedWorkspace(tx, input)) return null;
      const [latestRun] = await tx
        .select({ id: agentRuns.id })
        .from(agentRuns)
        .where(eq(agentRuns.jobId, input.workspaceId))
        .orderBy(desc(agentRuns.createdAt), desc(agentRuns.id))
        .limit(1);
      if (latestRun?.id !== input.agentRunId) return null;

      const [run] = await tx
        .update(agentRuns)
        .set({
          status: "interrupted",
          cancellationRequestedAt: input.now,
          completedAt: input.now,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(agentRuns.id, input.agentRunId),
            eq(agentRuns.jobId, input.workspaceId),
            inArray(agentRuns.status, ["queued", "running", "recoverable"]),
          ),
        )
        .returning({
          triggerRunId: agentRuns.triggerRunId,
          kind: agentRuns.kind,
          messageId: agentRuns.messageId,
        });
      if (!run) return null;

      if (run.kind === "challenge" && run.messageId) {
        const [message] = await tx
          .update(conversationMessages)
          .set({
            status: "recoverable",
            leaseId: null,
            leaseExpiresAt: null,
            updatedAt: input.now,
          })
          .where(and(
            eq(conversationMessages.id, run.messageId),
            eq(conversationMessages.userId, input.userId),
            inArray(conversationMessages.status, ["queued", "running"]),
          ))
          .returning({ id: conversationMessages.id });
        if (message) {
          await this.appendConversationEvent(tx, {
            jobId: input.workspaceId,
            userId: input.userId,
            messageId: run.messageId,
            now: input.now,
          }, "recoverable");
        }
      }

      const [workspace] = await tx
        .update(analysisJobs)
        .set({ status: "interrupted", updatedAt: input.now })
        .where(
          and(
            eq(analysisJobs.id, input.workspaceId),
            eq(analysisJobs.userId, input.userId),
            inArray(analysisJobs.status, ["queued", "running", "partial", "interrupted", "recoverable", "completed"]),
          ),
        )
        .returning({ id: analysisJobs.id });
      if (!workspace) throw new Error("Agent run workspace state changed");

      const [event] = await tx
        .insert(analysisEvents)
        .values({
          jobId: input.workspaceId,
          userId: input.userId,
          eventType: "agent.run.interrupted",
          payload: { agentRunId: input.agentRunId },
          createdAt: input.now,
        })
        .returning({ id: analysisEvents.id });
      return { triggerRunId: run.triggerRunId, eventId: event.id };
    });
  }

  async finishAgentRun(input: FinishAgentRun): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      if (!await this.lockOwnedWorkspace(tx, input)) return false;

      const [run] = await tx
        .update(agentRuns)
        .set({ status: input.status, completedAt: input.now, updatedAt: input.now })
        .where(
          and(
            eq(agentRuns.id, input.agentRunId),
            eq(agentRuns.jobId, input.workspaceId),
            inArray(
              agentRuns.status,
              input.status === "recoverable" ? ["queued", "running"] : ["running"],
            ),
          ),
        )
        .returning({ id: agentRuns.id, kind: agentRuns.kind, messageId: agentRuns.messageId });
      if (!run) return false;

      if (input.status === "recoverable" && run.kind === "challenge" && run.messageId) {
        const [message] = await tx
          .update(conversationMessages)
          .set({
            status: "recoverable",
            leaseId: null,
            leaseExpiresAt: null,
            updatedAt: input.now,
          })
          .where(and(
            eq(conversationMessages.id, run.messageId),
            eq(conversationMessages.userId, input.userId),
            inArray(conversationMessages.status, ["queued", "running"]),
          ))
          .returning({ id: conversationMessages.id });
        if (message) {
          await this.appendConversationEvent(tx, {
            jobId: input.workspaceId,
            userId: input.userId,
            messageId: run.messageId,
            now: input.now,
          }, "recoverable");
        }
      }

      const [workspace] = await tx
        .update(analysisJobs)
        .set({
          status: input.status,
          updatedAt: input.now,
          ...(input.status === "completed" ? { completedAt: input.now } : {}),
          ...(input.status === "recoverable" ? { completedAt: null } : {}),
        })
        .where(
          and(
            eq(analysisJobs.id, input.workspaceId),
            eq(analysisJobs.userId, input.userId),
            inArray(
              analysisJobs.status,
              input.status === "recoverable"
                ? ["queued", "running", "partial", "interrupted", "recoverable", "completed"]
                : ["running"],
            ),
          ),
        )
        .returning({ id: analysisJobs.id });
      if (!workspace) throw new Error("Agent run workspace state changed");
      await tx.insert(analysisEvents).values({
        jobId: input.workspaceId,
        userId: input.userId,
        eventType: input.status === "completed" ? "agent.run.completed" : "job.recoverable",
        payload: { agentRunId: input.agentRunId },
        createdAt: input.now,
      });
      return true;
    });
  }

  async appendAgentToolCall(input: NewAgentToolCall) {
    const summary = safeAgentSummarySchema.parse(input.summary);
    return this.db.transaction(async (tx) => {
      const [run] = await tx
        .select({ id: agentRuns.id })
        .from(agentRuns)
        .innerJoin(analysisJobs, eq(analysisJobs.id, agentRuns.jobId))
        .where(
          and(
            eq(agentRuns.id, input.agentRunId),
            eq(agentRuns.jobId, input.workspaceId),
            eq(analysisJobs.userId, input.userId),
            inArray(agentRuns.status, ["queued", "running"]),
          ),
        )
        .for("update")
        .limit(1);
      if (!run) return null;

      const [existing] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(agentToolCalls)
        .where(eq(agentToolCalls.agentRunId, input.agentRunId));
      if (Number(existing?.count ?? 0) >= 16) return { code: "TOOL_CALL_BUDGET_EXCEEDED" as const };

      const [call] = await tx
        .insert(agentToolCalls)
        .values({
          agentRunId: input.agentRunId,
          toolName: input.toolName,
          status: "running",
          summary,
          createdAt: input.now,
        })
        .returning({ id: agentToolCalls.id });
      await this.appendToolCallEvent(tx, {
        workspaceId: input.workspaceId,
        userId: input.userId,
        agentRunId: input.agentRunId,
        toolCallId: call.id,
        status: "running",
        now: input.now,
      });
      return call;
    });
  }

  async finishAgentToolCall(input: FinishAgentToolCall): Promise<boolean> {
    const summary = safeAgentSummarySchema.parse(input.summary);
    const artifact = input.artifact === undefined
      ? undefined
      : workspaceToolArtifactSchema.parse(input.artifact);
    return this.db.transaction(async (tx) => {
      const [call] = await tx
        .select({ id: agentToolCalls.id, toolName: agentToolCalls.toolName })
        .from(agentToolCalls)
        .innerJoin(agentRuns, eq(agentRuns.id, agentToolCalls.agentRunId))
        .innerJoin(analysisJobs, eq(analysisJobs.id, agentRuns.jobId))
        .where(
          and(
            eq(agentToolCalls.id, input.id),
            eq(agentToolCalls.agentRunId, input.agentRunId),
            eq(agentToolCalls.status, "running"),
            eq(agentRuns.jobId, input.workspaceId),
            eq(agentRuns.status, "running"),
            eq(analysisJobs.userId, input.userId),
          ),
        )
        .for("update")
        .limit(1);
      if (!call) return false;
      const artifactToolName = artifact ? toolNameForArtifact(artifact) : undefined;
      if (artifact && (input.status !== "completed" || artifactToolName !== call.toolName)) return false;

      const [finished] = await tx
        .update(agentToolCalls)
        .set({
          status: input.status,
          summary,
          errorCode: input.errorCode ?? null,
          ...(artifact !== undefined ? { artifact } : {}),
          completedAt: input.now,
        })
        .where(
          and(
            eq(agentToolCalls.id, input.id),
            eq(agentToolCalls.agentRunId, input.agentRunId),
            eq(agentToolCalls.status, "running"),
            this.ownedAgentToolCallExists(tx, input),
          ),
        )
        .returning({ id: agentToolCalls.id });
      if (finished) {
        await this.appendToolCallEvent(tx, {
          workspaceId: input.workspaceId,
          userId: input.userId,
          agentRunId: input.agentRunId,
          toolCallId: input.id,
          status: input.status,
          now: input.now,
        });
      }
      return Boolean(finished);
    });
  }

  async saveAgentToolArtifact(input: SaveAgentToolArtifact): Promise<boolean> {
    const artifact = workspaceToolArtifactSchema.parse(input.artifact);
    return this.db.transaction(async (tx) => {
      if (!await this.isCurrentRunningAgentRun(tx, input)) return false;

      const [call] = await tx
        .select({ id: agentToolCalls.id, toolName: agentToolCalls.toolName })
        .from(agentToolCalls)
        .innerJoin(agentRuns, eq(agentRuns.id, agentToolCalls.agentRunId))
        .innerJoin(analysisJobs, eq(analysisJobs.id, agentRuns.jobId))
        .where(and(
          eq(agentToolCalls.id, input.id),
          eq(agentToolCalls.agentRunId, input.agentRunId),
          eq(agentToolCalls.status, "running"),
          eq(agentRuns.jobId, input.workspaceId),
          eq(analysisJobs.userId, input.userId),
        ))
        .limit(1);
      if (!call || toolNameForArtifact(artifact) !== call.toolName) return false;

      const [saved] = await tx
        .update(agentToolCalls)
        .set({ artifact })
        .where(and(
          eq(agentToolCalls.id, input.id),
          eq(agentToolCalls.agentRunId, input.agentRunId),
          eq(agentToolCalls.status, "running"),
        ))
        .returning({ id: agentToolCalls.id });
      return Boolean(saved);
    });
  }

  async findCompletedAgentToolArtifact(input: FindAgentToolArtifact) {
    return (await this.listCompletedAgentToolArtifacts(input))[0] ?? null;
  }

  async listCompletedAgentToolArtifacts(input: FindAgentToolArtifact) {
    const calls = await this.db
      .select({ artifact: agentToolCalls.artifact })
      .from(agentToolCalls)
      .innerJoin(agentRuns, eq(agentRuns.id, agentToolCalls.agentRunId))
      .innerJoin(analysisJobs, eq(analysisJobs.id, agentRuns.jobId))
      .where(and(
        eq(agentToolCalls.toolName, input.toolName),
        eq(agentToolCalls.status, "completed"),
        eq(agentRuns.jobId, input.workspaceId),
        eq(analysisJobs.userId, input.userId),
      ))
      .orderBy(desc(agentToolCalls.completedAt), desc(agentToolCalls.id));
    return calls.flatMap((call) => {
      const parsed = workspaceToolArtifactSchema.safeParse(call.artifact);
      return parsed.success ? [parsed.data] : [];
    });
  }

  async listPersistedAgentToolArtifacts(input: FindAgentToolArtifact) {
    const calls = await this.db
      .select({ artifact: agentToolCalls.artifact })
      .from(agentToolCalls)
      .innerJoin(agentRuns, eq(agentRuns.id, agentToolCalls.agentRunId))
      .innerJoin(analysisJobs, eq(analysisJobs.id, agentRuns.jobId))
      .where(and(
        eq(agentToolCalls.toolName, input.toolName),
        eq(agentRuns.jobId, input.workspaceId),
        eq(analysisJobs.userId, input.userId),
      ))
      .orderBy(desc(agentToolCalls.createdAt), desc(agentToolCalls.id));
    return calls.flatMap((call) => {
      const parsed = workspaceToolArtifactSchema.safeParse(call.artifact);
      return parsed.success ? [parsed.data] : [];
    });
  }

  async listCompletedWorkspaceToolNames(input: Pick<FindAgentToolArtifact, "workspaceId" | "userId">) {
    const calls = await this.db
      .selectDistinct({ toolName: agentToolCalls.toolName })
      .from(agentToolCalls)
      .innerJoin(agentRuns, eq(agentRuns.id, agentToolCalls.agentRunId))
      .innerJoin(analysisJobs, eq(analysisJobs.id, agentRuns.jobId))
      .where(and(
        eq(agentToolCalls.status, "completed"),
        eq(agentRuns.jobId, input.workspaceId),
        eq(analysisJobs.userId, input.userId),
      ));
    return calls.map((call) => call.toolName);
  }

  async startExpertRun(input: StartExpertRun): Promise<string> {
    return this.db.transaction(async (tx) => {
      await tx
        .select({ id: analysisJobs.id })
        .from(analysisJobs)
        .where(eq(analysisJobs.id, input.jobId))
        .for("update");
      const [latest] = await tx
        .select({ attempt: expertRuns.attempt })
        .from(expertRuns)
        .where(and(
          eq(expertRuns.jobId, input.jobId),
          eq(expertRuns.expertType, input.expertType),
          eq(expertRuns.phase, input.phase),
        ))
        .orderBy(desc(expertRuns.attempt))
        .limit(1);
      const [run] = await tx
        .insert(expertRuns)
        .values({
          ...input,
          attempt: Math.max(input.attempt, (latest?.attempt ?? 0) + 1),
          status: "running",
          createdAt: input.now,
          startedAt: input.now,
          updatedAt: input.now,
        })
        .returning({ id: expertRuns.id });
      return run.id;
    });
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
      if (!await this.isCurrentRunningAgentRun(tx, {
        workspaceId: input.jobId,
        userId: input.userId,
        agentRunId: input.agentRunId,
      })) return;
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

  async saveSourcesModule(
    input: SaveModule & { moduleType: "sources"; payload: BaselineDraft["sources"] },
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (!await this.isCurrentRunningAgentRun(tx, {
        workspaceId: input.jobId,
        userId: input.userId,
        agentRunId: input.agentRunId,
      })) return;
      const [updated] = await tx
        .update(reportModules)
        .set({
          status: input.status,
          errorCode: input.errorCode ?? null,
          payload: input.payload as Record<string, unknown>,
          version: input.nextVersion,
          updatedAt: input.now,
        })
        .where(and(
          eq(reportModules.reportId, input.reportId),
          eq(reportModules.moduleType, "sources"),
          eq(reportModules.version, input.expectedVersion),
          this.ownedReportExists(tx, input),
        ))
        .returning({ id: reportModules.id });
      if (!updated) return;

      await this.syncReportSources(tx, input.reportId, input.payload.sources);
      await tx.insert(analysisEvents).values({
        jobId: input.jobId,
        userId: input.userId,
        eventType: "module.updated",
        payload: {
          moduleType: "sources",
          status: input.status,
          version: input.nextVersion,
          errorCode: input.errorCode ?? null,
        },
        createdAt: input.now,
      });
    });
  }

  async saveRevisionDraft(input: SaveRevisionDraft): Promise<boolean> {
    if (moduleTypes.some((moduleType) => {
      const nextVersion = input.nextVersions[moduleType];
      const expectedVersion = input.expectedVersions[moduleType];
      return nextVersion !== expectedVersion && nextVersion !== expectedVersion + 1;
    })) return false;

    try {
      return await this.db.transaction(async (tx) => {
        if (!await this.isCurrentRunningAgentRun(tx, {
          workspaceId: input.jobId,
          userId: input.userId,
          agentRunId: input.agentRunId,
        })) return false;
        const [owned] = await tx
          .select({ id: reports.id })
          .from(reports)
          .innerJoin(analysisJobs, eq(analysisJobs.id, reports.jobId))
          .where(and(
            eq(reports.id, input.reportId),
            eq(reports.jobId, input.jobId),
            eq(reports.userId, input.userId),
            eq(analysisJobs.userId, input.userId),
          ))
          .for("update")
          .limit(1);
        if (!owned) return false;

        for (const moduleType of moduleTypes) {
          const [updated] = await tx
            .update(reportModules)
            .set({
              status: "completed",
              errorCode: null,
              payload: input.draft[moduleType] as Record<string, unknown>,
              version: input.nextVersions[moduleType],
              updatedAt: input.now,
            })
            .where(and(
              eq(reportModules.reportId, input.reportId),
              eq(reportModules.moduleType, moduleType),
              eq(reportModules.version, input.expectedVersions[moduleType]),
            ))
            .returning({ id: reportModules.id });
          if (!updated) throw new RevisionDraftConflictError();
        }

        await this.syncReportSources(tx, input.reportId, input.draft.sources.sources);
        const changedModuleTypes = moduleTypes.filter((moduleType) =>
          input.nextVersions[moduleType] !== input.expectedVersions[moduleType]
        );
        if (changedModuleTypes.length) {
          await tx.insert(analysisEvents).values(changedModuleTypes.map((moduleType) => ({
            jobId: input.jobId,
            userId: input.userId,
            eventType: "module.updated" as const,
            payload: {
              moduleType,
              status: "completed",
              version: input.nextVersions[moduleType],
              errorCode: null,
            },
            createdAt: input.now,
          })));
        }
        return true;
      });
    } catch (error) {
      if (error instanceof RevisionDraftConflictError) return false;
      throw error;
    }
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

function toolNameForArtifact(artifact: WorkspaceToolArtifact): string {
  if (artifact.kind === "baseline_module") {
    return {
      argument: "analyze_argument",
      sources: "research_sources",
      perspectives: "map_perspectives",
      risks: "review_risks",
    }[artifact.moduleType];
  }
  return {
    synthesis: "synthesize_report",
    draft_review: "review_draft",
    revision: "revise_report",
  }[artifact.kind];
}

class RevisionDraftConflictError extends Error {}
