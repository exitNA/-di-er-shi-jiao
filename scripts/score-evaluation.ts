import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  evaluationReportSchema,
  evaluationRunMetricsSchema,
  evaluationThresholds,
  reviewerColumns,
  reviewerDecisionSchema,
  type EvaluationCounts,
  type EvaluationReport,
  type EvaluationScores,
  type ReviewerDecision,
} from "@/server/evaluation/contracts";
import { qualityGate, scoreEvaluation } from "@/server/evaluation/scoring";

const latestSchema = z.object({ runDirectory: z.string().min(1) });

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const runDirectory = options.runDirectory ?? await latestRunDirectory();
  const [metricsText, reportsText] = await Promise.all([
    readFile(resolve(runDirectory, "metrics.json"), "utf8"),
    readFile(resolve(runDirectory, "reports.jsonl"), "utf8"),
  ]);
  const metrics = evaluationRunMetricsSchema.parse(JSON.parse(metricsText));
  const reports = reportsText
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => evaluationReportSchema.parse(JSON.parse(line)));
  if (reports.length !== metrics.totalReports) {
    throw new Error("reports.jsonl count does not match metrics.json");
  }

  const reviewerA = await readReviewer(
    resolve(runDirectory, "reviewer-a.csv"),
    reports,
  );
  const reviewerB = await readReviewer(
    resolve(runDirectory, "reviewer-b.csv"),
    reports,
  );
  const reviewerBById = new Map(reviewerB.map((decision) => [decision.sampleId, decision]));
  const disagreements = reviewerA.filter(
    (decision) =>
      decisionKey(decision) !== decisionKey(reviewerBById.get(decision.sampleId)!),
  );
  if (disagreements.length > 0) {
    console.log(`Disagreements: ${disagreements.map((row) => row.sampleId).join(", ")}`);
  } else {
    console.log("Disagreements: none");
  }

  let adjudication = new Map<string, ReviewerDecision>();
  if (options.adjudicationFile) {
    if (disagreements.length === 0) {
      throw new Error("adjudication is only accepted when reviewer sheets disagree");
    }
    const disputedReports = reports.filter((report) =>
      disagreements.some((decision) => decision.sampleId === report.sampleId),
    );
    adjudication = new Map(
      (await readReviewer(options.adjudicationFile, disputedReports)).map((decision) => [
        decision.sampleId,
        decision,
      ]),
    );
  } else if (disagreements.length > 0) {
    throw new Error("provide --adjudication <csv> for every disagreement");
  }

  const decisions = reviewerA.map(
    (decision) =>
      adjudication.get(decision.sampleId) ??
      (decisionKey(decision) === decisionKey(reviewerBById.get(decision.sampleId)!)
        ? decision
        : undefined),
  );
  if (decisions.some((decision) => decision === undefined)) {
    throw new Error("adjudication is incomplete");
  }

  const resolved = decisions as ReviewerDecision[];
  const counts = resolved.reduce<EvaluationCounts>(
    (result, decision) => ({
      ...result,
      reportsWithSixUsableModules:
        result.reportsWithSixUsableModules + Number(decision.structureComplete),
      reachableCitationUrls:
        result.reachableCitationUrls + decision.reachableCitationUrls,
      citedUrls: result.citedUrls + decision.citedUrls,
      reviewerSupportedRelations:
        result.reviewerSupportedRelations + decision.reviewerSupportedRelations,
      reviewedRelations: result.reviewedRelations + decision.reviewedRelations,
      correctHighConfidenceRisks:
        result.correctHighConfidenceRisks + decision.correctHighConfidenceRisks,
      highConfidenceRisks:
        result.highConfidenceRisks + decision.highConfidenceRisks,
      reportsPassingBothReviewersOrAdjudication:
        result.reportsPassingBothReviewersOrAdjudication + Number(decision.neutral),
    }),
    {
      totalReports: metrics.totalReports,
      reportsWithSixUsableModules: 0,
      citedUrls: 0,
      reachableCitationUrls: 0,
      reviewedRelations: 0,
      reviewerSupportedRelations: 0,
      highConfidenceRisks: 0,
      correctHighConfidenceRisks: 0,
      reviewedReports: resolved.length,
      reportsPassingBothReviewersOrAdjudication: 0,
      usableReportsIncludingExplicitSourceDegradation:
        metrics.usableReportsIncludingExplicitSourceDegradation,
      firstModuleLatenciesMs: metrics.firstModuleLatenciesMs,
      baselineLatenciesMs: metrics.baselineLatenciesMs,
    },
  );
  const scores = scoreEvaluation(counts);
  const gate = qualityGate(scores);

  for (const key of Object.keys(scores) as Array<keyof EvaluationScores>) {
    const latency = key.endsWith("Ms");
    console.log(
      `${key}: ${formatScore(scores[key], latency)} ` +
        `(threshold ${latency ? "≤" : "≥"} ${formatScore(evaluationThresholds[key], latency)}) ` +
        `${gate.checks[key] ? "PASS" : "FAIL"}`,
    );
  }
  if (!gate.passed) process.exitCode = 1;
}

async function latestRunDirectory(): Promise<string> {
  const latest = latestSchema.parse(
    JSON.parse(await readFile(resolve("tmp/evaluations/latest.json"), "utf8")),
  );
  return latest.runDirectory;
}

function parseArguments(arguments_: string[]): {
  runDirectory?: string;
  adjudicationFile?: string;
} {
  let runDirectory: string | undefined;
  let adjudicationFile: string | undefined;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--adjudication") {
      adjudicationFile = arguments_[index + 1];
      if (!adjudicationFile) throw new Error("--adjudication requires a CSV path");
      index += 1;
    } else if (argument.startsWith("-")) {
      throw new Error(`unknown option: ${argument}`);
    } else if (runDirectory) {
      throw new Error("eval:score accepts at most one run directory");
    } else {
      runDirectory = argument;
    }
  }
  return { runDirectory, adjudicationFile };
}

async function readReviewer(
  file: string,
  reports: EvaluationReport[],
): Promise<ReviewerDecision[]> {
  const rows = parseCsv(await readFile(file, "utf8"));
  const header = rows.shift();
  if (!header || header.join("\u0000") !== reviewerColumns.join("\u0000")) {
    throw new Error(`${file} has an invalid header`);
  }
  const reportById = new Map(reports.map((report) => [report.sampleId, report]));
  if (rows.length !== reportById.size) {
    throw new Error(`${file} must contain exactly ${reportById.size} completed rows`);
  }

  const seen = new Set<string>();
  return rows.map((row, index) => {
    if (row.length !== reviewerColumns.length) {
      throw new Error(`${file}:${index + 2} must contain ${reviewerColumns.length} columns`);
    }
    const [
      sampleId,
      structureComplete,
      citationUrlValid,
      citationSupport,
      correctHighConfidenceRisks,
      highConfidenceRisks,
      neutral,
      notes,
    ] = row;
    const report = reportById.get(sampleId);
    if (!report || seen.has(sampleId)) {
      throw new Error(`${file}:${index + 2} has an unknown or duplicate sample_id`);
    }
    seen.add(sampleId);
    const citationUrls = parseRatio(citationUrlValid, `${file}:${index + 2} citation_url_valid`);
    const support = parseRatio(citationSupport, `${file}:${index + 2} citation_support`);
    const decision = reviewerDecisionSchema.parse({
      sampleId,
      structureComplete: parsePassFail(
        structureComplete,
        `${file}:${index + 2} structure_complete`,
      ),
      reachableCitationUrls: citationUrls.numerator,
      citedUrls: citationUrls.denominator,
      reviewerSupportedRelations: support.numerator,
      reviewedRelations: support.denominator,
      correctHighConfidenceRisks: parseInteger(
        correctHighConfidenceRisks,
        `${file}:${index + 2} high_confidence_risks_correct`,
      ),
      highConfidenceRisks: parseInteger(
        highConfidenceRisks,
        `${file}:${index + 2} high_confidence_risks_total`,
      ),
      neutral: parsePassFail(neutral, `${file}:${index + 2} neutral`),
      notes,
    });
    if (decision.highConfidenceRisks !== report.highConfidenceRisksTotal) {
      throw new Error(
        `${file}:${index + 2} high_confidence_risks_total must equal the generated report total`,
      );
    }
    return decision;
  });
}

function parsePassFail(value: string, field: string): boolean {
  if (value === "pass") return true;
  if (value === "fail") return false;
  throw new Error(`${field} must be pass or fail`);
}

function parseRatio(value: string, field: string): {
  numerator: number;
  denominator: number;
} {
  const match = /^(\d+)\/(\d+)$/.exec(value);
  if (!match) throw new Error(`${field} must use numerator/denominator`);
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (numerator > denominator) throw new Error(`${field} numerator cannot exceed denominator`);
  return { numerator, denominator };
}

function parseInteger(value: string, field: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${field} must be a non-negative integer`);
  return Number(value);
}

function decisionKey(decision: ReviewerDecision): string {
  return JSON.stringify({
    structureComplete: decision.structureComplete,
    reachableCitationUrls: decision.reachableCitationUrls,
    citedUrls: decision.citedUrls,
    reviewerSupportedRelations: decision.reviewerSupportedRelations,
    reviewedRelations: decision.reviewedRelations,
    correctHighConfidenceRisks: decision.correctHighConfidenceRisks,
    highConfidenceRisks: decision.highConfidenceRisks,
    neutral: decision.neutral,
  });
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("CSV has an unterminated quoted field");
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((value) => value.some((cell) => cell.length > 0));
}

function formatScore(value: number, latency: boolean): string {
  if (!Number.isFinite(value)) return "n/a";
  return latency ? `${Math.round(value)} ms` : `${(value * 100).toFixed(1)}%`;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Evaluation scoring failed");
  process.exitCode = 1;
});
