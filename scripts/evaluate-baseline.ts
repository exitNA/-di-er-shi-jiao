import { mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { baselineDraftSchema, type SourcesModule } from "@/features/analysis/domain/contracts";
import { TavilySearchClient } from "@/server/adapters/search/tavily-search-client";
import { analyzeArgument, createArgumentExpert } from "@/server/agents/argument/agent";
import type { ExpertSuite } from "@/server/agents/expert-suite";
import { createPerspectivesExpert, mapPerspectives, reviewDraft } from "@/server/agents/perspectives/agent";
import { createRisksExpert, reviewRisks } from "@/server/agents/risks/agent";
import { createSourcesExpert, researchSources } from "@/server/agents/sources/agent";
import {
  createSynthesisExpert,
  createTargetedReviewExpert,
  reviewTarget,
  reviseDraft,
  synthesize,
} from "@/server/agents/synthesis/agent";
import { loadServerEnv, reasoningEffortForAgent } from "@/server/config/env";
import {
  createPiSession,
  createProjectPiModelRuntime,
} from "@/server/agents/shared/pi-session";
import type { ExpertSessionFactory } from "@/server/agents/shared/expert-harness";
import {
  evaluationReportSchema,
  evaluationRunMetricsSchema,
  reviewerColumns,
  type EvaluationReport,
} from "@/server/evaluation/contracts";
import {
  evaluationSampleSchema,
  evaluationSamples,
  type EvaluationSample,
} from "../tests/fixtures/evaluation-samples";

const configVersion = "baseline-v1";

async function main(): Promise<void> {
  const samples = evaluationSamples.map((sample) => evaluationSampleSchema.parse(sample));
  if (new Set(samples.map((sample) => sample.id)).size !== 30 || samples.length !== 30) {
    throw new Error("evaluation corpus must contain 30 unique samples");
  }

  if (process.argv.includes("--validate-only")) {
    console.log(`${samples.length} valid samples`);
    return;
  }

  const runDirectory = resolve(
    "tmp/evaluations",
    configVersion,
    new Date().toISOString().replaceAll(":", "-"),
  );
  await mkdir(runDirectory, { recursive: true });

  const suite = createRealExpertSuite();
  const reports: EvaluationReport[] = [];
  for (const sample of samples) {
    console.log(`Evaluating ${sample.id}`);
    reports.push(await evaluateSample(suite, sample));
  }

  const metrics = evaluationRunMetricsSchema.parse({
    configVersion,
    generatedAt: new Date().toISOString(),
    totalReports: reports.length,
    reportsWithSixUsableModules: reports.filter((report) => report.report !== null).length,
    usableReportsIncludingExplicitSourceDegradation: reports.filter(
      (report) => report.status === "success" || report.status === "degraded",
    ).length,
    firstModuleLatenciesMs: reports.flatMap((report) =>
      report.firstModuleLatencyMs === null ? [] : [report.firstModuleLatencyMs],
    ),
    baselineLatenciesMs: reports.map((report) => report.baselineLatencyMs),
  });
  const reviewerSheet = createReviewerSheet(reports);

  await Promise.all([
    writeFile(
      resolve(runDirectory, "reports.jsonl"),
      `${reports.map((report) => JSON.stringify(report)).join("\n")}\n`,
      "utf8",
    ),
    writeFile(resolve(runDirectory, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`, "utf8"),
    writeFile(resolve(runDirectory, "reviewer-a.csv"), reviewerSheet, "utf8"),
    writeFile(resolve(runDirectory, "reviewer-b.csv"), reviewerSheet, "utf8"),
  ]);
  await mkdir(resolve("tmp/evaluations"), { recursive: true });
  await writeFile(
    resolve("tmp/evaluations/latest.json"),
    `${JSON.stringify({ runDirectory }, null, 2)}\n`,
    "utf8",
  );
  console.log(`Evaluation artifacts written to ${runDirectory}`);
}

function createRealExpertSuite(): ExpertSuite {
  const env = loadServerEnv();
  const piRuntime = createProjectPiModelRuntime({
    baseURL: env.LLM_BASE_URL,
    apiKey: env.LLM_API_KEY,
    modelId: env.LLM_MODEL_ID,
    inputUsdPerMillion: env.LLM_INPUT_USD_PER_MILLION,
    outputUsdPerMillion: env.LLM_OUTPUT_USD_PER_MILLION,
  });
  const createExpertSession: ExpertSessionFactory = async (input) => {
    const { model, modelRuntime } = await piRuntime;
    return createPiSession({
      ...input,
      model,
      modelRuntime,
      reasoningEffort: reasoningEffortForAgent(env, basename(input.resourceDir)),
    });
  };
  const argumentExpert = createArgumentExpert(createExpertSession);
  const perspectivesExpert = createPerspectivesExpert(createExpertSession);
  const risksExpert = createRisksExpert(createExpertSession);
  const synthesisExpert = createSynthesisExpert(createExpertSession);
  const searchTool = env.TAVILY_API_KEY
    ? new TavilySearchClient({ apiKey: env.TAVILY_API_KEY })
    : undefined;
  const sourcesExpert = createSourcesExpert(createExpertSession, searchTool);
  return {
    analyzeArgument: (input) => analyzeArgument(argumentExpert, input),
    mapPerspectives: (input) => mapPerspectives(perspectivesExpert.mapPerspectives, input),
    researchSources: (input) => researchSources(sourcesExpert, input),
    reviewRisks: (input) => reviewRisks(risksExpert, input),
    synthesize: (input) => synthesize(synthesisExpert.synthesize, input),
    reviewDraft: (input) => reviewDraft(perspectivesExpert.reviewDraft, input),
    reviseDraft: (input) => reviseDraft(synthesisExpert.reviseDraft, input),
    reviewTarget: (input) => reviewTarget(createTargetedReviewExpert(createExpertSession, input), input),
  };
}

async function evaluateSample(
  suite: ExpertSuite,
  sample: EvaluationSample,
): Promise<EvaluationReport> {
  const startedAt = performance.now();
  let firstModuleLatencyMs: number | null = null;

  try {
    const timed = async <T>(operation: Promise<T>): Promise<T> => {
      const value = await operation;
      const latency = Math.round(performance.now() - startedAt);
      firstModuleLatencyMs = Math.min(firstModuleLatencyMs ?? latency, latency);
      return value;
    };
    const factualOnly = sample.tags.includes("factual-only");
    const [argumentResult, perspectivesResult, sourcesResult, risksResult] =
      await Promise.allSettled([
        timed(suite.analyzeArgument({ material: sample.content, factualOnly })),
        timed(suite.mapPerspectives({ material: sample.content, factualOnly })),
        timed(suite.researchSources({ material: sample.content, factualOnly })),
        timed(suite.reviewRisks({ material: sample.content, factualOnly })),
      ]);

    const argument = settledValue(argumentResult);
    const perspectives = settledValue(perspectivesResult);
    const risks = settledValue(risksResult);
    const sourceDegraded = sourcesResult.status === "rejected";
    const sources = sourceDegraded ? degradedSources() : sourcesResult.value.value;
    const expertOutputs = {
      argument: argument.value,
      perspectives: perspectives.value,
      sources,
      risks: risks.value,
    };
    const synthesis = await suite.synthesize({ material: sample.content, factualOnly, ...expertOutputs });
    const draft = baselineDraftSchema.parse({ ...expertOutputs, ...synthesis.value });
    const review = await suite.reviewDraft({ material: sample.content, factualOnly, draft });
    const revision = await suite.reviseDraft({
      material: sample.content,
      factualOnly,
      ...expertOutputs,
      draft,
      findings: review.value.findings,
    });
    const report = baselineDraftSchema.parse(revision.value);

    return evaluationReportSchema.parse({
      sampleId: sample.id,
      language: sample.language,
      tags: sample.tags,
      status: sourceDegraded ? "degraded" : "success",
      report,
      errorCode: sourceDegraded ? errorCode(sourcesResult.reason) : null,
      firstModuleLatencyMs,
      baselineLatencyMs: Math.round(performance.now() - startedAt),
      citedUrls: [...new Set(report.sources.sources.map((source) => source.url))],
      highConfidenceRisksTotal: report.risks.items.filter(
        (risk) => risk.confidence.score >= 0.8,
      ).length,
    });
  } catch (error) {
    return evaluationReportSchema.parse({
      sampleId: sample.id,
      language: sample.language,
      tags: sample.tags,
      status: "failed",
      report: null,
      errorCode: errorCode(error),
      firstModuleLatencyMs,
      baselineLatencyMs: Math.round(performance.now() - startedAt),
      citedUrls: [],
      highConfidenceRisksTotal: 0,
    });
  }
}

function settledValue<T>(result: PromiseSettledResult<T>): T {
  if (result.status === "fulfilled") return result.value;
  throw result.reason;
}

function degradedSources(): SourcesModule {
  return {
    claims: [],
    sources: [],
    relations: [],
    gaps: [
      {
        id: "evaluation-source-degradation",
        text: "外部信源暂不可用，本报告明确降级且不提供未经核验的引用。",
        origin: "ai_inference",
        confidence: { score: 1, rationale: "信源专家执行失败" },
      },
    ],
  };
}

function errorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.length > 0
  ) {
    return error.code;
  }
  return error instanceof Error && error.name ? error.name : "UNKNOWN_ERROR";
}

function createReviewerSheet(reports: EvaluationReport[]): string {
  return `${reviewerColumns.join(",")}\n${reports
    .map((report) => `${csvCell(report.sampleId)},,,,,${report.highConfidenceRisksTotal},,`)
    .join("\n")}\n`;
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Evaluation failed");
  process.exitCode = 1;
});
