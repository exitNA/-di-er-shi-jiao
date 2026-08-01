import { randomUUID } from "node:crypto";
import { getLogger } from "@logtape/logtape";
import {
  argumentModuleSchema,
  baselineDraftSchema,
  perspectivesModuleSchema,
  risksModuleSchema,
  sourcesModuleSchema,
  type AnalysisSnapshot,
  type BaselineDraft,
  type ReportModuleType,
} from "@/features/analysis/domain/contracts";
import type { AnalysisRepository, ExecutionJob } from "@/features/analysis/server/analysis-repository";
import type { GenerationUsage } from "@/server/ai/structured-generator";
import {
  calculateTokenCostUsd,
  formatTokenCostUsd,
} from "@/server/observability/cost";
import {
  type ProductEventInput,
  type ProductEventRecorder,
} from "@/server/observability/product-events";
import { withSpan } from "@/server/observability/tracing";
import type { ExpertResult, ExpertSuite } from "./expert-suite";

type IndependentModule = "argument" | "perspectives" | "sources" | "risks";
type RetryableModule = IndependentModule;

export type RunSummary = {
  status: "already-running" | "not-found" | "completed" | "partial" | "recoverable";
};

const independentModules: readonly IndependentModule[] = ["argument", "perspectives", "sources", "risks"];
const timeoutsMs: Record<IndependentModule | "synthesis" | "review" | "revision", number> = {
  argument: 25_000,
  perspectives: 25_000,
  sources: 40_000,
  risks: 25_000,
  synthesis: 25_000,
  review: 25_000,
  revision: 25_000,
};

const emptySources: BaselineDraft["sources"] = { claims: [], sources: [], relations: [], gaps: [] };
const logger = getLogger(["second-perspective", "analysis"]);

export class BaselineOrchestrator {
  constructor(
    private readonly experts: ExpertSuite,
    private readonly repository: AnalysisRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly productEventRecorder: ProductEventRecorder = async () => false,
  ) {}

  async run(input: { jobId: string; onlyModule?: ReportModuleType }): Promise<RunSummary> {
    return withSpan("analysis.job", { jobId: input.jobId }, () =>
      this.runJob(input),
    );
  }

  private async runJob(input: { jobId: string; onlyModule?: ReportModuleType }): Promise<RunSummary> {
    if (input.onlyModule === "overview" || input.onlyModule === "reflection") {
      throw new Error("Overview and reflection are regenerated from expert outputs");
    }

    const job = await this.repository.getJobForExecution(input.jobId);
    if (!job) return { status: "not-found" };
    const before = await this.snapshot(job);
    if (!before) return { status: "not-found" };
    const retry = input.onlyModule as RetryableModule | undefined;
    if (retry && before.modules[retry].status !== "failed") {
      throw new Error(`Only failed modules can be retried: ${retry}`);
    }

    const acquired = retry && job.status === "running"
      ? true
      : await this.repository.transitionJob(
          input.jobId,
          ["queued", "partial", "recoverable"],
          "running",
          { now: this.now() },
        );
    if (!acquired) return { status: "already-running" };
    await this.repository.appendEvent({ jobId: job.jobId, userId: job.userId, eventType: "job.started", payload: { state: "running" }, now: this.now() });

    const snapshot = await this.snapshot(job);
    if (!snapshot) return { status: "not-found" };

    const modules = retry
      ? [retry]
      : independentModules.filter((moduleType) => snapshot.modules[moduleType].status !== "completed");
    const settled = await Promise.allSettled(modules.map((moduleType) => this.runIndependent(job, snapshot, moduleType)));
    const failures = settled.filter((result): result is PromiseFulfilledResult<IndependentResult> => result.status === "fulfilled").map((result) => result.value).filter((result): result is IndependentFailure => !result.ok);
    const rejected = settled.filter((result): result is PromiseRejectedResult => result.status === "rejected");

    if (rejected.length) {
      return this.recover(job, "ORCHESTRATION_FAILED");
    }
    if (failures.some((failure) => failure.moduleType !== "sources")) {
      return this.recover(job, failures.find((failure) => failure.moduleType !== "sources")?.errorCode ?? "EXPERT_FAILED");
    }

    const current = await this.snapshot(job);
    if (!current) return { status: "not-found" };
    return this.publish(
      job,
      current,
      modules,
      failures.find((failure) => failure.moduleType === "sources")?.errorCode,
    );
  }

  private async runIndependent(job: ExecutionJob, snapshot: AnalysisSnapshot, moduleType: IndependentModule): Promise<IndependentResult> {
    const current = snapshot.modules[moduleType];
    const runningVersion = current.version + 1;
    const attempt = runningVersion;
    await this.repository.saveModule({
      jobId: job.jobId,
      reportId: job.reportId,
      userId: job.userId,
      moduleType,
      status: "running",
      expectedVersion: current.version,
      nextVersion: runningVersion,
      now: this.now(),
    });
    const result = await this.runExpert(job, moduleType, "baseline", attempt, timeoutsMs[moduleType], async (abortSignal) => {
      let raw: ExpertResult<unknown>;
      switch (moduleType) {
        case "argument": raw = await this.experts.analyzeArgument({ material: job.material, abortSignal }); break;
        case "perspectives": raw = await this.experts.mapPerspectives({ material: job.material, abortSignal }); break;
        case "sources": raw = await this.experts.researchSources({ material: job.material, abortSignal }); break;
        case "risks": raw = await this.experts.reviewRisks({ material: job.material, abortSignal }); break;
      }
      return { ...raw, value: parseModule(moduleType, raw.value) };
    });

    if (!result.ok) {
      await this.repository.saveModule({
        jobId: job.jobId, reportId: job.reportId, userId: job.userId, moduleType, status: "failed", errorCode: result.errorCode,
        expectedVersion: runningVersion, nextVersion: runningVersion + 1, now: this.now(),
      });
      return { ok: false, moduleType, errorCode: result.errorCode };
    }

    const payload = result.value;
    await this.repository.saveModule({
      jobId: job.jobId, reportId: job.reportId, userId: job.userId, moduleType, status: "completed", payload,
      expectedVersion: runningVersion, nextVersion: runningVersion + 1, now: this.now(),
    });
    if (moduleType === "sources") await this.repository.replaceSources(job.reportId, (payload as BaselineDraft["sources"]).sources);
    return { ok: true, moduleType, value: payload };
  }

  private async publish(
    job: ExecutionJob,
    snapshot: AnalysisSnapshot,
    updatedModules: readonly IndependentModule[],
    sourceError?: string,
  ): Promise<RunSummary> {
    const required = ["argument", "perspectives", "risks"] as const;
    if (required.some((moduleType) => snapshot.modules[moduleType].status !== "completed" || !snapshot.modules[moduleType].payload)) {
      return this.recover(job, "REQUIRED_MODULE_UNAVAILABLE");
    }
    const argument = snapshot.modules.argument.payload as BaselineDraft["argument"];
    const perspectives = snapshot.modules.perspectives.payload as BaselineDraft["perspectives"];
    const risks = snapshot.modules.risks.payload as BaselineDraft["risks"];
    const sources = snapshot.modules.sources.status === "completed" && snapshot.modules.sources.payload
      ? snapshot.modules.sources.payload as BaselineDraft["sources"]
      : emptySources;

    try {
      const synthesis = await this.runExpert(job, "synthesis", "baseline", snapshot.modules.overview.version + 1, timeoutsMs.synthesis, (abortSignal) =>
        this.experts.synthesize({ material: job.material, argument, perspectives, sources, risks, abortSignal }),
      );
      if (!synthesis.ok) return this.recover(job, synthesis.errorCode);
      const draft = { ...synthesis.value, argument, perspectives, sources, risks };
      const review = await this.runExpert(job, "perspectives", "second-review", snapshot.modules.perspectives.version + 1, timeoutsMs.review, (abortSignal) =>
        this.experts.reviewDraft({ material: job.material, draft, abortSignal }),
      );
      if (!review.ok) return this.recover(job, review.errorCode);
      const revision = await this.runExpert(job, "synthesis", "revision", snapshot.modules.overview.version + 2, timeoutsMs.revision, (abortSignal) =>
        this.experts.reviseDraft({ material: job.material, argument, perspectives, sources, risks, draft, findings: review.value.findings, abortSignal }),
      );
      if (!revision.ok) return this.recover(job, revision.errorCode);

      const finalDraft = baselineDraftSchema.parse(revision.value);
      const modulesToPublish = new Set<ReportModuleType>([
        "overview",
        "reflection",
        ...updatedModules,
      ]);
      for (const moduleType of modulesToPublish) {
        if (moduleType === "sources" && sourceError) continue;
        const currentModule = snapshot.modules[moduleType];
        await this.repository.saveModule({
          jobId: job.jobId, reportId: job.reportId, userId: job.userId, moduleType, status: "completed", payload: finalDraft[moduleType],
          expectedVersion: currentModule.version, nextVersion: currentModule.version + 1, now: this.now(),
        });
      }
      if (!sourceError) await this.repository.replaceSources(job.reportId, finalDraft.sources.sources);

      const status = sourceError ? "partial" : "completed";
      await this.repository.transitionJob(job.jobId, ["running"], status, { now: this.now() });
      await this.repository.appendEvent({
        jobId: job.jobId, userId: job.userId, eventType: sourceError ? "report.degraded" : "baseline.completed",
        payload: sourceError ? { moduleType: "sources", errorCode: sourceError } : { state: "completed" }, now: this.now(),
      });
      await this.recordProductEventSafely(
        sourceError
          ? {
              eventName: "report_degraded",
              jobId: job.jobId,
              userId: job.userId,
              moduleType: "sources",
              moduleVersion: snapshot.modules.sources.version,
              errorCode: sourceError,
              now: this.now(),
            }
          : {
              eventName: "baseline_report_completed",
              jobId: job.jobId,
              userId: job.userId,
              now: this.now(),
            },
      );
      return { status };
    } catch (error) {
      return this.recover(job, errorCode(error));
    }
  }

  private async runExpert<T>(
    job: ExecutionJob,
    expertType: "argument" | "sources" | "perspectives" | "risks" | "synthesis",
    phase: "baseline" | "second-review" | "revision",
    attempt: number,
    timeoutMs: number,
    run: (abortSignal: AbortSignal) => Promise<ExpertResult<T>>,
  ): Promise<ExpertSuccess<T> | ExpertFailure> {
    const id = randomUUID();
    const started = Date.now();
    const attributes = {
      jobId: job.jobId,
      expertType,
      phase,
      attempt,
    };
    await this.repository.startExpertRun({ id, jobId: job.jobId, expertType, phase, attempt, configVersion: job.configVersion, now: this.now() });
    try {
      const result = await withSpan("analysis.expert", attributes, () =>
        this.runExpertOperation(
          expertType,
          phase,
          attributes,
          timeoutMs,
          run,
        ),
      );
      const durationMs = Date.now() - started;
      await this.finishRun(id, "completed", result.usage, durationMs);
      logger.info("Expert run completed", { jobId: job.jobId, operation: `${expertType}.${phase}`, durationMs, attempt });
      return { ok: true, value: result.value };
    } catch (error) {
      const code = errorCode(error);
      const durationMs = Date.now() - started;
      await this.finishRun(id, "failed", undefined, durationMs, code);
      logger.error("Expert run failed", { jobId: job.jobId, operation: `${expertType}.${phase}`, errorCode: code, durationMs, attempt });
      return { ok: false, errorCode: code };
    }
  }

  private runExpertOperation<T>(
    expertType: "argument" | "sources" | "perspectives" | "risks" | "synthesis",
    phase: "baseline" | "second-review" | "revision",
    attributes: Record<string, string | number>,
    timeoutMs: number,
    run: (abortSignal: AbortSignal) => Promise<ExpertResult<T>>,
  ): Promise<ExpertResult<T>> {
    const generate = () =>
      withSpan("llm.generate", attributes, () => withTimeout(timeoutMs, run));
    const externalOperation =
      expertType === "sources" && phase === "baseline"
        ? () => withSpan("search.request", attributes, generate)
        : generate;
    const workflowSpan =
      phase === "second-review"
        ? "analysis.review"
        : expertType === "synthesis"
          ? "analysis.synthesis"
          : null;
    return workflowSpan
      ? withSpan(workflowSpan, attributes, externalOperation)
      : externalOperation();
  }

  private finishRun(id: string, status: "completed" | "failed", usage: GenerationUsage | undefined, latencyMs: number, errorCode?: string) {
    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    const cost = calculateTokenCostUsd(inputTokens, outputTokens, {
      inputUsdPerMillion: environmentPrice("LLM_INPUT_USD_PER_MILLION"),
      outputUsdPerMillion: environmentPrice("LLM_OUTPUT_USD_PER_MILLION"),
    });
    return this.repository.finishExpertRun({ id, status, inputTokens, outputTokens, estimatedCostUsd: formatTokenCostUsd(cost), latencyMs: usage?.latencyMs ?? latencyMs, errorCode, now: this.now() });
  }

  private async recover(job: ExecutionJob, failureCode: string): Promise<RunSummary> {
    await this.repository.transitionJob(job.jobId, ["running"], "recoverable", { failureCode, now: this.now() });
    await this.repository.appendEvent({ jobId: job.jobId, userId: job.userId, eventType: "job.recoverable", payload: { errorCode: failureCode }, now: this.now() });
    logger.error("Analysis job recovered", { jobId: job.jobId, operation: "analysis.job", errorCode: failureCode });
    return { status: "recoverable" };
  }

  private async recordProductEventSafely(input: ProductEventInput): Promise<void> {
    try {
      await this.productEventRecorder(input);
    } catch {
      logger.error("Product event recording failed", { jobId: input.jobId, errorCode: "PRODUCT_EVENT_FAILED" });
    }
  }

  private snapshot(job: ExecutionJob) {
    return this.repository.getOwnedSnapshot(job.userId, job.jobId);
  }
}

type ExpertSuccess<T> = { ok: true; value: T };
type ExpertFailure = { ok: false; errorCode: string };
type IndependentSuccess = ExpertSuccess<BaselineDraft[IndependentModule]> & { moduleType: IndependentModule };
type IndependentFailure = ExpertFailure & { moduleType: IndependentModule };
type IndependentResult = IndependentSuccess | IndependentFailure;

function parseModule<T>(moduleType: IndependentModule, value: T): BaselineDraft[IndependentModule] {
  switch (moduleType) {
    case "argument": return argumentModuleSchema.parse(value);
    case "perspectives": return perspectivesModuleSchema.parse(value);
    case "sources": return sourcesModuleSchema.parse(value);
    case "risks": return risksModuleSchema.parse(value);
  }
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") return error.code;
  if (error instanceof Error && error.name === "ZodError") return "INVALID_EXPERT_OUTPUT";
  return "EXPERT_FAILED";
}

function environmentPrice(
  name: "LLM_INPUT_USD_PER_MILLION" | "LLM_OUTPUT_USD_PER_MILLION",
): number {
  const value = Number(process.env[name] ?? 0);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function withTimeout<T>(milliseconds: number, run: (abortSignal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = Object.assign(new Error("EXPERT_TIMEOUT"), { code: "EXPERT_TIMEOUT" });
      controller.abort(error);
      reject(error);
    }, milliseconds);
    run(controller.signal).then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
