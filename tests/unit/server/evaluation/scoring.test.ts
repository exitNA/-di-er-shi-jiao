import { describe, expect, it } from "vitest";
import type { EvaluationCounts } from "@/server/evaluation/contracts";
import { percentile95, qualityGate, scoreEvaluation } from "@/server/evaluation/scoring";

const passingCounts: EvaluationCounts = {
  totalReports: 10,
  reportsWithSixUsableModules: 9,
  citedUrls: 20,
  reachableCitationUrls: 19,
  reviewedRelations: 20,
  reviewerSupportedRelations: 17,
  highConfidenceRisks: 10,
  correctHighConfidenceRisks: 8,
  reviewedReports: 20,
  reportsPassingBothReviewersOrAdjudication: 17,
  usableReportsIncludingExplicitSourceDegradation: 9,
  firstModuleLatenciesMs: [1_000, 10_000],
  baselineLatenciesMs: [20_000, 60_000],
};

describe("evaluation scoring", () => {
  it("calculates all eight specified metrics", () => {
    expect(scoreEvaluation(passingCounts)).toEqual({
      structureCompleteness: 0.9,
      validCitationRate: 0.95,
      citationSupportRate: 0.85,
      highConfidenceRiskPrecision: 0.8,
      neutralityPassRate: 0.85,
      reportSuccessRate: 0.9,
      firstModuleP95Ms: 10_000,
      baselineP95Ms: 60_000,
    });
  });

  it("uses the nearest-rank 95th percentile without changing the input", () => {
    const values = Array.from({ length: 20 }, (_, index) => 20 - index);

    expect(percentile95(values)).toBe(19);
    expect(values[0]).toBe(20);
  });

  it("passes values exactly on every quality threshold", () => {
    expect(qualityGate(scoreEvaluation(passingCounts))).toEqual({
      passed: true,
      checks: {
        structureCompleteness: true,
        validCitationRate: true,
        citationSupportRate: true,
        highConfidenceRiskPrecision: true,
        neutralityPassRate: true,
        reportSuccessRate: true,
        firstModuleP95Ms: true,
        baselineP95Ms: true,
      },
    });
  });

  it("fails every metric whose denominator or latency sample is empty", () => {
    const empty = scoreEvaluation({
      ...passingCounts,
      totalReports: 0,
      citedUrls: 0,
      reviewedRelations: 0,
      highConfidenceRisks: 0,
      reviewedReports: 0,
      firstModuleLatenciesMs: [],
      baselineLatenciesMs: [],
    });

    expect(Object.values(qualityGate(empty).checks).every((passed) => !passed)).toBe(true);
  });
});
