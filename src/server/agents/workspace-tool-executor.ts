import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { getLogger } from "@logtape/logtape";

import {
  argumentModuleSchema,
  baselineDraftSchema,
  isTargetScopedModuleReplacement,
  moduleTypes,
  overviewModuleSchema,
  perspectivesModuleSchema,
  reflectionModuleSchema,
  reportModuleSourceIds,
  resolveReportItemTarget,
  risksModuleSchema,
  sourcesModuleSchema,
  type AnalysisSnapshot,
  type BaselineDraft,
  type ReportItemTarget,
  type ReportModuleType,
  type SourcesModule,
} from "@/features/analysis/domain/contracts";
import type {
  AnalysisRepository,
  ExecutionJob,
  RevisionModuleUpdate,
} from "@/features/analysis/server/analysis-repository";
import { targetedReviewSchema } from "@/features/conversation/domain/contracts";
import type { WorkspaceToolArtifact } from "@/features/analysis/domain/workspace";
import {
  calculateTokenCostUsd,
  formatTokenCostUsd,
} from "@/server/observability/cost";
import {
  draftReviewSchema,
  synthesisOutputSchema,
  type GenerationUsage,
  type ExpertResult,
  type ExpertSuite,
} from "./expert-suite";

export const workspaceToolNames = [
  "analyze_argument",
  "research_sources",
  "map_perspectives",
  "review_risks",
  "synthesize_report",
  "review_draft",
  "revise_report",
  "publish_report",
  "review_target",
] as const;

export type WorkspaceToolName = (typeof workspaceToolNames)[number];

export type AgentToolContext = {
  workspaceId: string;
  agentRunId: string;
  signal?: AbortSignal;
  messageId?: string;
  target?: ReportItemTarget;
};

export type AgentToolResult =
  | { ok: true; summary: string }
  | { ok: false; code: string };

export type PeerExpertName =
  | "argument"
  | "sources"
  | "perspectives"
  | "risks"
  | "synthesis";

export type ReportActionName =
  | "review_draft"
  | "revise_report"
  | "publish_report"
  | "review_target";

export type RunPeerExpertInput = AgentToolContext & {
  expert: PeerExpertName;
  task?: string;
};

export type RunReportActionInput = AgentToolContext & {
  action: ReportActionName;
};

type WorkspaceExecutionContext = AgentToolContext & { task?: string };

type OwnedWorkspace = {
  job: ExecutionJob;
  snapshot: AnalysisSnapshot;
};

type ToolExecution = {
  result: AgentToolResult;
  artifact?: WorkspaceToolArtifact;
  toolCallFinished?: boolean;
};

const moduleSchemas = {
  overview: overviewModuleSchema,
  argument: argumentModuleSchema,
  perspectives: perspectivesModuleSchema,
  sources: sourcesModuleSchema,
  risks: risksModuleSchema,
  reflection: reflectionModuleSchema,
};

const baselineToolModules = [
  { toolName: "analyze_argument", moduleType: "argument" },
  { toolName: "research_sources", moduleType: "sources" },
  { toolName: "map_perspectives", moduleType: "perspectives" },
  { toolName: "review_risks", moduleType: "risks" },
] as const;

const revisionLeaseMs = 30_000;
const logger = getLogger(["second-perspective", "agent-tool"]);

export class WorkspaceToolExecutor {
  constructor(
    private readonly experts: ExpertSuite,
    private readonly repository: AnalysisRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  runExpert(input: RunPeerExpertInput): Promise<AgentToolResult> {
    if (input.task && input.task.length > 2_000) {
      return Promise.resolve({ ok: false, code: "INVALID_EXPERT_TASK" });
    }
    const toolNames: Record<PeerExpertName, WorkspaceToolName> = {
      argument: "analyze_argument",
      sources: "research_sources",
      perspectives: "map_perspectives",
      risks: "review_risks",
      synthesis: "synthesize_report",
    };
    return this.execute(toolNames[input.expert], input);
  }

  runReportAction(input: RunReportActionInput): Promise<AgentToolResult> {
    return this.execute(input.action, input);
  }

  async execute(name: WorkspaceToolName, context: WorkspaceExecutionContext): Promise<AgentToolResult> {
    const owned = await this.assertRunnable(context);
    if (
      (owned.snapshot.activeRun?.kind === "challenge")
      !== (name === "review_target")
    ) return { ok: false, code: "TOOL_NOT_ALLOWED" };
    const call = await this.repository.appendAgentToolCall({
      workspaceId: context.workspaceId,
      userId: owned.job.userId,
      agentRunId: context.agentRunId,
      toolName: name,
      summary: statusSummary(name),
      now: this.now(),
    });
    if (!call) return { ok: false, code: "AGENT_RUN_UNAVAILABLE" };
    if ("code" in call) return { ok: false, code: call.code };

    try {
      const execution = await this.runValidatedTool(name, context, owned.job.userId, call.id);
      if (execution.toolCallFinished) return execution.result;
      if (execution.artifact) {
        const artifactSaved = await this.repository.saveAgentToolArtifact({
          workspaceId: context.workspaceId,
          userId: owned.job.userId,
          agentRunId: context.agentRunId,
          id: call.id,
          artifact: execution.artifact,
        });
        if (!artifactSaved) return { ok: false, code: "AGENT_RUN_INTERRUPTED" };
      }
      const finished = await this.repository.finishAgentToolCall({
        workspaceId: context.workspaceId,
        userId: owned.job.userId,
        agentRunId: context.agentRunId,
        id: call.id,
        status: execution.result.ok ? "completed" : "recoverable",
        summary: completedSummary(name, execution.result),
        ...(!execution.result.ok ? { errorCode: execution.result.code } : {}),
        ...(execution.artifact ? { artifact: execution.artifact } : {}),
        now: this.now(),
      });
      return finished ? execution.result : { ok: false, code: "AGENT_RUN_INTERRUPTED" };
    } catch (error) {
      const code = errorCode(error);
      const baselineModule = baselineToolModules.find((candidate) => candidate.toolName === name);
      if (baselineModule && !context.signal?.aborted) {
        const current = owned.snapshot.modules[baselineModule.moduleType];
        await this.repository.saveModule({
          jobId: owned.job.jobId,
          reportId: owned.snapshot.reportId,
          userId: owned.job.userId,
          agentRunId: context.agentRunId,
          moduleType: baselineModule.moduleType,
          status: "failed",
          errorCode: code,
          expectedVersion: current.version,
          nextVersion: current.version + 1,
          now: this.now(),
        });
      }
      await this.repository.finishAgentToolCall({
        workspaceId: context.workspaceId,
        userId: owned.job.userId,
        agentRunId: context.agentRunId,
        id: call.id,
        status: "recoverable",
        summary: `工具未完成（${code}）。`,
        errorCode: code,
        now: this.now(),
      });
      return { ok: false, code };
    }
  }

  private async assertRunnable(context: AgentToolContext): Promise<OwnedWorkspace> {
    if (context.signal?.aborted) throw context.signal.reason ?? codedError("AGENT_RUN_INTERRUPTED");
    const job = await this.repository.getJobForExecution(context.workspaceId);
    if (!job) throw codedError("WORKSPACE_NOT_FOUND");
    const snapshot = await this.repository.getOwnedSnapshot(job.userId, context.workspaceId);
    if (
      !snapshot
      || snapshot.workspaceId !== context.workspaceId
      || snapshot.activeRun?.id !== context.agentRunId
      || snapshot.activeRun.status !== "running"
      || snapshot.activeRun.cancellationRequestedAt !== null
    ) {
      throw codedError("AGENT_RUN_UNAVAILABLE");
    }
    return { job, snapshot };
  }

  private async runValidatedTool(
    name: WorkspaceToolName,
    context: WorkspaceExecutionContext,
    userId: string,
    toolCallId: string,
  ): Promise<ToolExecution> {
    const owned = await this.loadOwned(context, userId);
    switch (name) {
      case "analyze_argument": {
        const current = owned.snapshot.modules.argument;
        const generated = await this.trackExpertRun(
          owned.job,
          context.agentRunId,
          "argument",
          "baseline",
          current.version + 1,
          () => this.experts.analyzeArgument({ material: owned.job.material, ...expertRequest(context) }),
        );
        const payload = argumentModuleSchema.parse(generated.value);
        await this.saveModule(owned, "argument", payload);
        return baselineSuccess("argument", current.version + 1, "核心主张与论证结构已核对。");
      }
      case "research_sources": {
        const current = owned.snapshot.modules.sources;
        const generated = await this.trackExpertRun(
          owned.job,
          context.agentRunId,
          "sources",
          "baseline",
          current.version + 1,
          () => this.experts.researchSources({ material: owned.job.material, ...expertRequest(context) }),
        );
        const payload = sourcesModuleSchema.parse(generated.value);
        await this.saveModule(owned, "sources", payload);
        return baselineSuccess("sources", current.version + 1, `已核对 ${payload.sources.length} 个外部信源。`);
      }
      case "map_perspectives": {
        const current = owned.snapshot.modules.perspectives;
        const generated = await this.trackExpertRun(
          owned.job,
          context.agentRunId,
          "perspectives",
          "baseline",
          current.version + 1,
          () => this.experts.mapPerspectives({ material: owned.job.material, ...expertRequest(context) }),
        );
        const payload = perspectivesModuleSchema.parse(generated.value);
        await this.saveModule(owned, "perspectives", payload);
        return baselineSuccess("perspectives", current.version + 1, "支持、反对与利益相关方视角已整理。");
      }
      case "review_risks": {
        const current = owned.snapshot.modules.risks;
        const generated = await this.trackExpertRun(
          owned.job,
          context.agentRunId,
          "risks",
          "baseline",
          current.version + 1,
          () => this.experts.reviewRisks({ material: owned.job.material, ...expertRequest(context) }),
        );
        const payload = risksModuleSchema.parse(generated.value);
        await this.saveModule(owned, "risks", payload);
        return baselineSuccess("risks", current.version + 1, `已识别 ${payload.items.length} 项推理风险。`);
      }
      case "synthesize_report":
        return this.synthesize(owned, context);
      case "review_draft":
        return this.reviewDraft(owned, context);
      case "revise_report":
        return this.reviseReport(owned, context);
      case "publish_report":
        return this.publish(owned);
      case "review_target":
        return this.reviewTarget(owned, context, toolCallId);
    }
  }

  private async synthesize(owned: OwnedWorkspace, context: WorkspaceExecutionContext): Promise<ToolExecution> {
    const experts = independentOutputs(owned.snapshot);
    if (!experts) return failure("REQUIRED_TOOL_UNAVAILABLE");
    const inputVersions = moduleVersions(owned.snapshot);
    const generated = await this.trackExpertRun(
      owned.job,
      context.agentRunId,
      "synthesis",
      "baseline",
      owned.snapshot.modules.overview.version + 1,
      () => this.experts.synthesize({
        material: owned.job.material,
        ...experts,
        ...expertRequest(context),
      }),
    );
    const synthesis = synthesisOutputSchema.parse(generated.value);
    const draft = baselineDraftSchema.parse({ ...experts, ...synthesis });
    assertPersistedSourceReferences(draft);
    await this.saveModule(owned, "overview", synthesis.overview);
    const latest = await this.loadOwned(context, owned.job.userId);
    const saved = await this.saveModule(latest, "reflection", synthesis.reflection);
    return {
      ...success("六模块综合草稿已保存。"),
      artifact: {
        kind: "synthesis",
        inputVersions,
        outputVersions: moduleVersions(saved.snapshot),
      },
    };
  }

  private async reviewDraft(owned: OwnedWorkspace, context: AgentToolContext): Promise<ToolExecution> {
    const synthesisArtifacts = await this.repository.listPersistedAgentToolArtifacts({
      workspaceId: owned.job.jobId,
      userId: owned.job.userId,
      toolName: "synthesize_report",
    });
    if (
      !synthesisArtifacts.some((artifact) =>
        artifact.kind === "synthesis"
        && sameModuleVersions(artifact.outputVersions, owned.snapshot)
      )
    ) return failure("REQUIRED_TOOL_UNAVAILABLE");
    const draft = persistedDraft(owned.snapshot);
    if (!draft) return failure("REQUIRED_TOOL_UNAVAILABLE");
    const generated = await this.trackExpertRun(
      owned.job,
      context.agentRunId,
      "perspectives",
      "second-review",
      owned.snapshot.modules.perspectives.version + 1,
      () => this.experts.reviewDraft({ material: owned.job.material, draft, abortSignal: context.signal }),
    );
    const review = draftReviewSchema.parse(generated.value);
    return {
      ...success(`二次审校完成，记录 ${review.findings.length} 项修订要求。`),
      artifact: { kind: "draft_review", review, inputVersions: moduleVersions(owned.snapshot) },
    };
  }

  private async reviseReport(owned: OwnedWorkspace, context: AgentToolContext): Promise<ToolExecution> {
    const artifacts = await this.repository.listPersistedAgentToolArtifacts({
      workspaceId: context.workspaceId,
      userId: owned.job.userId,
      toolName: "review_draft",
    });
    const draft = persistedDraft(owned.snapshot);
    const experts = independentOutputs(owned.snapshot);
    const artifact = artifacts.find((candidate) =>
      candidate.kind === "draft_review"
      && sameModuleVersions(candidate.inputVersions, owned.snapshot)
    );
    if (artifact?.kind !== "draft_review" || !draft || !experts) {
      return failure("REQUIRED_TOOL_UNAVAILABLE");
    }
    const generated = await this.trackExpertRun(
      owned.job,
      context.agentRunId,
      "synthesis",
      "revision",
      owned.snapshot.modules.overview.version + 1,
      () => this.experts.reviseDraft({
        material: owned.job.material,
        ...experts,
        draft,
        findings: artifact.review.findings,
        abortSignal: context.signal,
      }),
    );
    const revised = baselineDraftSchema.parse(generated.value);
    assertPersistedSourceReferences(revised);
    const inputVersions = moduleVersions(owned.snapshot);
    const outputVersions = Object.fromEntries(moduleTypes.map((moduleType) => [
      moduleType,
      inputVersions[moduleType] + (
        isDeepStrictEqual(owned.snapshot.modules[moduleType].payload, revised[moduleType]) ? 0 : 1
      ),
    ])) as Record<ReportModuleType, number>;
    const saved = await this.repository.saveRevisionDraft({
      jobId: owned.job.jobId,
      reportId: owned.snapshot.reportId,
      userId: owned.job.userId,
      agentRunId: context.agentRunId,
      draft: revised,
      expectedVersions: inputVersions,
      nextVersions: outputVersions,
      now: this.now(),
    });
    if (!saved) throw codedError("REPORT_VERSION_CHANGED");
    const snapshot = await this.repository.getOwnedSnapshot(owned.job.userId, owned.job.jobId);
    if (!snapshot || moduleTypes.some((moduleType) =>
      snapshot.modules[moduleType].status !== "completed"
      || snapshot.modules[moduleType].version !== outputVersions[moduleType]
      || !isDeepStrictEqual(snapshot.modules[moduleType].payload, revised[moduleType])
    )) {
      throw codedError("REPORT_VERSION_CHANGED");
    }
    return {
      ...success("二次审校要求已应用。"),
      artifact: {
        kind: "revision",
        inputVersions,
        outputVersions,
      },
    };
  }

  private async publish(owned: OwnedWorkspace): Promise<ToolExecution> {
    const [syntheses, reviews, revisions] = await Promise.all([
      this.repository.listPersistedAgentToolArtifacts({
        workspaceId: owned.job.jobId,
        userId: owned.job.userId,
        toolName: "synthesize_report",
      }),
      this.repository.listPersistedAgentToolArtifacts({
        workspaceId: owned.job.jobId,
        userId: owned.job.userId,
        toolName: "review_draft",
      }),
      this.repository.listPersistedAgentToolArtifacts({
        workspaceId: owned.job.jobId,
        userId: owned.job.userId,
        toolName: "revise_report",
      }),
    ]);
    const revision = revisions.find((artifact) =>
      artifact.kind === "revision"
      && sameModuleVersions(artifact.outputVersions, owned.snapshot)
    );
    const review = revision?.kind === "revision"
      ? reviews.find((artifact) =>
          artifact.kind === "draft_review"
          && sameVersionMaps(artifact.inputVersions, revision.inputVersions)
        )
      : undefined;
    const synthesis = review?.kind === "draft_review"
      ? syntheses.find((artifact) =>
          artifact.kind === "synthesis"
          && sameVersionMaps(artifact.outputVersions, review.inputVersions)
        )
      : undefined;
    if (
      revision?.kind !== "revision"
      || review?.kind !== "draft_review"
      || synthesis?.kind !== "synthesis"
    ) return failure("REQUIRED_TOOL_UNAVAILABLE");
    const draft = persistedDraft(owned.snapshot);
    if (!draft) return failure("REQUIRED_TOOL_UNAVAILABLE");
    assertPersistedSourceReferences(draft);
    return success("报告已通过发布约束检查。");
  }

  private async reviewTarget(
    owned: OwnedWorkspace,
    context: AgentToolContext,
    toolCallId: string,
  ): Promise<ToolExecution> {
    const message = [...owned.snapshot.messages].reverse().find((candidate) =>
      candidate.role === "user"
      && (candidate.status === "queued" || candidate.status === "recoverable")
      && (!context.messageId || candidate.id === context.messageId)
      && (!context.target || sameTarget(candidate.target, context.target))
    );
    if (!message || (context.target && !sameTarget(message.target, context.target))) {
      return failure("REQUIRED_TOOL_UNAVAILABLE");
    }
    if (!resolveReportItemTarget(owned.snapshot.modules, message.target)) {
      return failure("REQUIRED_TOOL_UNAVAILABLE");
    }

    const leaseId = randomUUID();
    const startedAt = this.now();
    const acquired = await this.repository.startRevision({
      jobId: context.workspaceId,
      reportId: owned.snapshot.reportId,
      userId: owned.job.userId,
      messageId: message.id,
      leaseId,
      leaseExpiresAt: new Date(startedAt.getTime() + revisionLeaseMs),
      now: startedAt,
    });
    if (!acquired) return failure("REQUIRED_TOOL_UNAVAILABLE");

    try {
      const execution = await this.loadOwned(context, owned.job.userId);
      const current = execution.snapshot.modules[message.target.moduleType];
      if (!current.payload) throw codedError("REQUIRED_TOOL_UNAVAILABLE");
      const sources = (execution.snapshot.modules.sources.payload as SourcesModule | undefined)?.sources ?? [];
      const allowedSourceIds = new Set(sources.map((source) => source.id));
      const generated = await this.trackExpertRun(
        execution.job,
        context.agentRunId,
        "synthesis",
        "revision",
        current.version + 1,
        () => this.experts.reviewTarget({
          material: execution.job.material,
          target: message.target,
          currentModule: current.payload as BaselineDraft[ReportModuleType],
          conversation: execution.snapshot.messages,
          newSources: sources,
          abortSignal: context.signal
            ? AbortSignal.any([context.signal, AbortSignal.timeout(25_000)])
            : AbortSignal.timeout(25_000),
        }),
      );
      const review = targetedReviewSchema(message.target.moduleType, allowedSourceIds).parse(generated.value);
      if (!review.replacement) {
        const result = success("定向复核已完成，当前报告无需修改。");
        const completed = await this.repository.completeRevisionResponse({
          jobId: context.workspaceId,
          reportId: execution.snapshot.reportId,
          userId: execution.job.userId,
          messageId: message.id,
          leaseId,
          agentContent: review.responseText,
          expectedReportVersion: execution.snapshot.currentVersion,
          target: message.target,
          expectedModuleVersion: current.version,
          toolCall: {
            agentRunId: context.agentRunId,
            id: toolCallId,
            summary: completedSummary("review_target", result.result),
          },
          now: this.now(),
        });
        if (!completed) throw codedError("REPORT_VERSION_CHANGED");
        return { ...result, toolCallFinished: true };
      }

      const parsedModule = moduleSchemas[message.target.moduleType].parse(review.replacement.module);
      if (!isTargetScopedModuleReplacement(
        current.payload as BaselineDraft[ReportModuleType],
        parsedModule,
        message.target,
      )) {
        throw codedError("INVALID_TARGET_REPLACEMENT");
      }
      const result = success("定向复核已完成，仅更新了目标条目。");
      const completed = await this.repository.completeRevision({
        jobId: context.workspaceId,
        reportId: execution.snapshot.reportId,
        userId: execution.job.userId,
        messageId: message.id,
        leaseId,
        agentContent: review.responseText,
        expectedReportVersion: execution.snapshot.currentVersion,
        module: revisionModule(message.target.moduleType, parsedModule, current.version),
        changes: [{
          target: message.target,
          reason: review.replacement.reason,
          newEvidenceSourceIds: review.replacement.newEvidenceSourceIds,
          summary: review.replacement.summary,
        }],
        toolCall: {
          agentRunId: context.agentRunId,
          id: toolCallId,
          summary: completedSummary("review_target", result.result),
        },
        now: this.now(),
      });
      if (!completed.completed) throw codedError("REPORT_VERSION_CHANGED");
      return { ...result, toolCallFinished: true };
    } catch (error) {
      await this.repository.recoverRevision({
        jobId: context.workspaceId,
        reportId: owned.snapshot.reportId,
        userId: owned.job.userId,
        messageId: message.id,
        leaseId,
        now: this.now(),
      });
      throw error;
    }
  }

  private async saveModule<ModuleType extends ReportModuleType>(
    owned: OwnedWorkspace,
    moduleType: ModuleType,
    payload: BaselineDraft[ModuleType],
  ): Promise<OwnedWorkspace> {
    const agentRunId = owned.snapshot.activeRun?.id;
    if (!agentRunId) throw codedError("AGENT_RUN_INTERRUPTED");
    const current = owned.snapshot.modules[moduleType];
    const parsed = moduleSchemas[moduleType].parse(payload) as BaselineDraft[ModuleType];
    const input = {
      jobId: owned.job.jobId,
      reportId: owned.snapshot.reportId,
      userId: owned.job.userId,
      agentRunId,
      moduleType,
      status: "completed" as const,
      payload: parsed,
      expectedVersion: current.version,
      nextVersion: current.version + 1,
      now: this.now(),
    };
    if (moduleType === "sources") {
      await this.repository.saveSourcesModule({
        ...input,
        moduleType,
        payload: sourcesModuleSchema.parse(parsed),
      });
    } else {
      await this.repository.saveModule(input);
    }
    const latest = await this.repository.getOwnedSnapshot(owned.job.userId, owned.job.jobId);
    if (
      latest?.modules[moduleType].status !== "completed"
      || latest.modules[moduleType].version !== current.version + 1
      || !isDeepStrictEqual(latest.modules[moduleType].payload, parsed)
    ) {
      throw codedError("REPORT_VERSION_CHANGED");
    }
    return { job: owned.job, snapshot: latest };
  }

  private async loadOwned(context: AgentToolContext, userId: string): Promise<OwnedWorkspace> {
    const job = await this.repository.getJobForExecution(context.workspaceId);
    const snapshot = await this.repository.getOwnedSnapshot(userId, context.workspaceId);
    if (!job || job.userId !== userId || !snapshot) throw codedError("WORKSPACE_NOT_FOUND");
    if (
      snapshot.activeRun?.id !== context.agentRunId
      || snapshot.activeRun.status !== "running"
      || snapshot.activeRun.cancellationRequestedAt !== null
      || context.signal?.aborted
    ) {
      throw context.signal?.reason ?? codedError("AGENT_RUN_INTERRUPTED");
    }
    return { job, snapshot };
  }

  private async trackExpertRun<T>(
    job: ExecutionJob,
    agentRunId: string,
    expertType: "argument" | "sources" | "perspectives" | "risks" | "synthesis",
    phase: "baseline" | "second-review" | "revision",
    attempt: number,
    run: () => Promise<ExpertResult<T>>,
  ): Promise<ExpertResult<T>> {
    const id = randomUUID();
    const startedAt = Date.now();
    await this.repository.appendEvent({
      jobId: job.jobId,
      userId: job.userId,
      eventType: "agent.ui.run.started",
      payload: {
        runId: id,
        parentRunId: agentRunId,
        threadId: job.jobId,
        agentId: `expert:${expertType}`,
        agentName: expertName(expertType),
      },
      now: this.now(),
    });
    await this.repository.appendEvent({
      jobId: job.jobId,
      userId: job.userId,
      eventType: "agent.ui.step.started",
      payload: { runId: id, stepName: phase },
      now: this.now(),
    });
    logger.info("Expert run started", { workspaceId: job.jobId, expertRunId: id, expertType, phase, attempt });
    await this.repository.startExpertRun({
      id,
      jobId: job.jobId,
      expertType,
      phase,
      attempt,
      configVersion: job.configVersion,
      now: this.now(),
    });
    try {
      const result = await run();
      await this.finishExpertRun(id, "completed", result.usage, Date.now() - startedAt);
      await this.repository.appendEvent({
        jobId: job.jobId,
        userId: job.userId,
        eventType: "agent.ui.activity",
        payload: {
          runId: id,
          messageId: `${id}:output`,
          activityType: "expert.output",
          content: JSON.stringify(redactValue(result.value)),
        },
        now: this.now(),
      });
      await this.repository.appendEvent({
        jobId: job.jobId,
        userId: job.userId,
        eventType: "agent.ui.step.finished",
        payload: { runId: id, stepName: phase },
        now: this.now(),
      });
      await this.repository.appendEvent({
        jobId: job.jobId,
        userId: job.userId,
        eventType: "agent.ui.run.finished",
        payload: { runId: id, outcome: "success" },
        now: this.now(),
      });
      logger.info("Expert run completed", { workspaceId: job.jobId, expertRunId: id, expertType, phase, attempt, durationMs: Date.now() - startedAt });
      return result;
    } catch (error) {
      await this.finishExpertRun(id, "failed", undefined, Date.now() - startedAt, errorCode(error));
      await this.repository.appendEvent({
        jobId: job.jobId,
        userId: job.userId,
        eventType: "agent.ui.run.error",
        payload: { runId: id, message: redactError(error), code: errorCode(error) },
        now: this.now(),
      });
      logger.error("Expert run failed", {
        workspaceId: job.jobId,
        expertRunId: id,
        expertType,
        phase,
        attempt,
        durationMs: Date.now() - startedAt,
        errorCode: errorCode(error),
        ...safeErrorMetadata(error),
      });
      throw error;
    }
  }

  private finishExpertRun(
    id: string,
    status: "completed" | "failed",
    usage: GenerationUsage | undefined,
    latencyMs: number,
    errorCodeValue?: string,
  ) {
    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    const cost = calculateTokenCostUsd(inputTokens, outputTokens, {
      inputUsdPerMillion: environmentPrice("LLM_INPUT_USD_PER_MILLION"),
      outputUsdPerMillion: environmentPrice("LLM_OUTPUT_USD_PER_MILLION"),
    });
    return this.repository.finishExpertRun({
      id,
      status,
      inputTokens,
      outputTokens,
      estimatedCostUsd: formatTokenCostUsd(cost),
      latencyMs: usage?.latencyMs ?? latencyMs,
      ...(errorCodeValue ? { errorCode: errorCodeValue } : {}),
      now: this.now(),
    });
  }
}

function independentOutputs(snapshot: AnalysisSnapshot) {
  const argument = argumentModuleSchema.safeParse(snapshot.modules.argument.payload);
  const perspectives = perspectivesModuleSchema.safeParse(snapshot.modules.perspectives.payload);
  const sources = sourcesModuleSchema.safeParse(snapshot.modules.sources.payload);
  const risks = risksModuleSchema.safeParse(snapshot.modules.risks.payload);
  if (
    snapshot.modules.argument.status !== "completed"
    || snapshot.modules.perspectives.status !== "completed"
    || snapshot.modules.sources.status !== "completed"
    || snapshot.modules.risks.status !== "completed"
    || !argument.success
    || !perspectives.success
    || !sources.success
    || !risks.success
  ) return undefined;
  return {
    argument: argument.data,
    perspectives: perspectives.data,
    sources: sources.data,
    risks: risks.data,
  };
}

function persistedDraft(snapshot: AnalysisSnapshot): BaselineDraft | undefined {
  const payload = Object.fromEntries(
    moduleTypes.map((moduleType) => [moduleType, snapshot.modules[moduleType].payload]),
  );
  const parsed = baselineDraftSchema.safeParse(payload);
  return moduleTypes.every((moduleType) => snapshot.modules[moduleType].status === "completed") && parsed.success
    ? parsed.data
    : undefined;
}

function moduleVersions(snapshot: AnalysisSnapshot): Record<ReportModuleType, number> {
  return Object.fromEntries(
    moduleTypes.map((moduleType) => [moduleType, snapshot.modules[moduleType].version]),
  ) as Record<ReportModuleType, number>;
}

function sameModuleVersions(
  expected: Record<ReportModuleType, number>,
  snapshot: AnalysisSnapshot,
): boolean {
  return moduleTypes.every((moduleType) => expected[moduleType] === snapshot.modules[moduleType].version);
}

function sameVersionMaps(
  left: Record<ReportModuleType, number>,
  right: Record<ReportModuleType, number>,
): boolean {
  return moduleTypes.every((moduleType) => left[moduleType] === right[moduleType]);
}

function assertPersistedSourceReferences(draft: BaselineDraft): void {
  const sourceIds = new Set(draft.sources.sources.map((source) => source.id));
  const referenced = moduleTypes.flatMap((moduleType) => reportModuleSourceIds(moduleType, draft[moduleType]));
  if (!referenced.every((sourceId) => sourceIds.has(sourceId))) throw codedError("INVALID_EXPERT_OUTPUT");
}

function revisionModule(
  moduleType: ReportModuleType,
  payload: BaselineDraft[ReportModuleType],
  currentVersion: number,
): RevisionModuleUpdate {
  const versions = { expectedVersion: currentVersion, nextVersion: currentVersion + 1 };
  switch (moduleType) {
    case "overview": return { moduleType, payload: overviewModuleSchema.parse(payload), ...versions };
    case "argument": return { moduleType, payload: argumentModuleSchema.parse(payload), ...versions };
    case "perspectives": return { moduleType, payload: perspectivesModuleSchema.parse(payload), ...versions };
    case "sources": return { moduleType, payload: sourcesModuleSchema.parse(payload), ...versions };
    case "risks": return { moduleType, payload: risksModuleSchema.parse(payload), ...versions };
    case "reflection": return { moduleType, payload: reflectionModuleSchema.parse(payload), ...versions };
  }
}

function success(summary: string): ToolExecution {
  return { result: { ok: true, summary } };
}

function baselineSuccess(
  moduleType: "argument" | "sources" | "perspectives" | "risks",
  outputVersion: number,
  summary: string,
): ToolExecution {
  return {
    ...success(summary),
    artifact: { kind: "baseline_module", moduleType, outputVersion },
  };
}

function failure(code: string): ToolExecution {
  return { result: { ok: false, code } };
}

function statusSummary(name: WorkspaceToolName): string {
  const summaries: Record<WorkspaceToolName, string> = {
    analyze_argument: "正在核对核心主张。",
    research_sources: "正在查找并核验外部信源。",
    map_perspectives: "正在整理不同立场与利益相关方。",
    review_risks: "正在审查推理风险。",
    synthesize_report: "正在综合报告草稿。",
    review_draft: "正在进行独立二次审校。",
    revise_report: "正在应用审校要求。",
    publish_report: "正在检查报告发布条件。",
    review_target: "正在复核被质疑的报告条目。",
  };
  return summaries[name];
}

function completedSummary(name: WorkspaceToolName, result: AgentToolResult): string {
  return result.ok ? result.summary : `${statusSummary(name)} 未执行：${result.code}。`;
}

function sameTarget(left: ReportItemTarget, right: ReportItemTarget): boolean {
  return left.moduleType === right.moduleType && left.section === right.section && left.itemId === right.itemId;
}

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") return error.code;
  if (error instanceof Error && error.name === "ZodError") return "INVALID_EXPERT_OUTPUT";
  return "EXPERT_FAILED";
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (!value || typeof value !== "object") return typeof value === "string" ? redactText(value) : value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    /^(api[_-]?key|authorization|token|password|secret)$/i.test(key) ? "[REDACTED]" : redactValue(child),
  ]));
}

function redactError(error: unknown): string {
  return redactText(error instanceof Error ? error.message : "EXPERT_FAILED").slice(0, 500);
}

function redactText(value: string): string {
  return value
    .replace(/\b(?:sk|rk|pk)[_-][A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(/((?:api[_-]?key|authorization|token|password|secret)\s*[:=]\s*["']?)[^\s,"'}]+/gi, "$1[REDACTED]");
}

function expertName(expertType: "argument" | "sources" | "perspectives" | "risks" | "synthesis"): string {
  const names = {
    argument: "论证分析 Agent",
    sources: "信源研究 Agent",
    perspectives: "多视角挑战 Agent",
    risks: "风险审查 Agent",
    synthesis: "综合审校 Agent",
  } as const;
  return names[expertType];
}

function safeErrorMetadata(error: unknown): Record<string, string | number> {
  const outer = asRecord(error);
  const cause = outer && "cause" in outer ? outer.cause : undefined;
  const source = cause ?? error;
  const details = asRecord(source);
  const name = source instanceof Error ? source.name : "unknown";
  const message = source instanceof Error ? source.message.replace(/\s+/g, " ").slice(0, 240) : "";
  const statusCode = details && typeof details.statusCode === "number" ? details.statusCode : undefined;
  const headers = details && "responseHeaders" in details ? asRecord(details.responseHeaders) : undefined;
  const providerRequestId = headers
    ? firstString(headers["x-request-id"], headers["request-id"], headers["x-amzn-requestid"])
    : undefined;
  return {
    causeName: name,
    ...(message ? { causeMessage: message } : {}),
    ...(statusCode === undefined ? {} : { statusCode }),
    ...(providerRequestId ? { providerRequestId } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

function expertRequest(context: WorkspaceExecutionContext) {
  return {
    abortSignal: context.signal,
    ...(context.task ? { task: context.task } : {}),
  };
}

function environmentPrice(
  name: "LLM_INPUT_USD_PER_MILLION" | "LLM_OUTPUT_USD_PER_MILLION",
): number {
  const value = Number(process.env[name] ?? 0);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}
