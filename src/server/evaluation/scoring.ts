import {
  evaluationThresholds,
  type EvaluationCounts,
  type EvaluationScores,
} from "./contracts";

export function percentile95(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

export function scoreEvaluation(counts: EvaluationCounts): EvaluationScores {
  return {
    structureCompleteness: ratio(counts.reportsWithSixUsableModules, counts.totalReports),
    validCitationRate: ratio(counts.reachableCitationUrls, counts.citedUrls),
    citationSupportRate: ratio(counts.reviewerSupportedRelations, counts.reviewedRelations),
    highConfidenceRiskPrecision: ratio(counts.correctHighConfidenceRisks, counts.highConfidenceRisks),
    neutralityPassRate: ratio(
      counts.reportsPassingBothReviewersOrAdjudication,
      counts.reviewedReports,
    ),
    reportSuccessRate: ratio(
      counts.usableReportsIncludingExplicitSourceDegradation,
      counts.totalReports,
    ),
    firstModuleP95Ms: percentile95(counts.firstModuleLatenciesMs),
    baselineP95Ms: percentile95(counts.baselineLatenciesMs),
  };
}

export function qualityGate(scores: EvaluationScores): {
  passed: boolean;
  checks: Record<keyof EvaluationScores, boolean>;
} {
  const checks = {
    structureCompleteness: minimum(scores.structureCompleteness, evaluationThresholds.structureCompleteness),
    validCitationRate: minimum(scores.validCitationRate, evaluationThresholds.validCitationRate),
    citationSupportRate: minimum(scores.citationSupportRate, evaluationThresholds.citationSupportRate),
    highConfidenceRiskPrecision: minimum(
      scores.highConfidenceRiskPrecision,
      evaluationThresholds.highConfidenceRiskPrecision,
    ),
    neutralityPassRate: minimum(scores.neutralityPassRate, evaluationThresholds.neutralityPassRate),
    reportSuccessRate: minimum(scores.reportSuccessRate, evaluationThresholds.reportSuccessRate),
    firstModuleP95Ms: maximum(scores.firstModuleP95Ms, evaluationThresholds.firstModuleP95Ms),
    baselineP95Ms: maximum(scores.baselineP95Ms, evaluationThresholds.baselineP95Ms),
  };

  return {
    passed: Object.values(checks).every(Boolean),
    checks,
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : Number.NaN;
}

function minimum(value: number, threshold: number): boolean {
  return Number.isFinite(value) && value >= threshold;
}

function maximum(value: number, threshold: number): boolean {
  return Number.isFinite(value) && value <= threshold;
}
