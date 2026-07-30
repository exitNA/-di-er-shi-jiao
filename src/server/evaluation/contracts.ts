import { z } from "zod";
import { baselineDraftSchema } from "@/features/analysis/domain/contracts";

export const reviewerColumns = [
  "sample_id",
  "structure_complete",
  "citation_url_valid",
  "citation_support",
  "high_confidence_risks_correct",
  "high_confidence_risks_total",
  "neutral",
  "notes",
] as const;

export const evaluationReportSchema = z.object({
  sampleId: z.string().min(1),
  language: z.enum(["zh", "en", "mixed"]),
  tags: z.array(z.string().min(1)),
  status: z.enum(["success", "degraded", "failed"]),
  report: baselineDraftSchema.nullable(),
  errorCode: z.string().min(1).nullable(),
  firstModuleLatencyMs: z.number().nonnegative().nullable(),
  baselineLatencyMs: z.number().nonnegative(),
  citedUrls: z.array(z.string().url()),
  highConfidenceRisksTotal: z.number().int().nonnegative(),
});

export const evaluationRunMetricsSchema = z.object({
  configVersion: z.string().min(1),
  generatedAt: z.string().datetime(),
  totalReports: z.number().int().positive(),
  reportsWithSixUsableModules: z.number().int().nonnegative(),
  usableReportsIncludingExplicitSourceDegradation: z.number().int().nonnegative(),
  firstModuleLatenciesMs: z.array(z.number().nonnegative()),
  baselineLatenciesMs: z.array(z.number().nonnegative()),
});

export const reviewerDecisionSchema = z.object({
  sampleId: z.string().min(1),
  structureComplete: z.boolean(),
  reachableCitationUrls: z.number().int().nonnegative(),
  citedUrls: z.number().int().nonnegative(),
  reviewerSupportedRelations: z.number().int().nonnegative(),
  reviewedRelations: z.number().int().nonnegative(),
  correctHighConfidenceRisks: z.number().int().nonnegative(),
  highConfidenceRisks: z.number().int().nonnegative(),
  neutral: z.boolean(),
  notes: z.string(),
}).superRefine((value, context) => {
  for (const [numerator, denominator, path] of [
    [value.reachableCitationUrls, value.citedUrls, "citationUrlValid"],
    [value.reviewerSupportedRelations, value.reviewedRelations, "citationSupport"],
    [value.correctHighConfidenceRisks, value.highConfidenceRisks, "highConfidenceRisksCorrect"],
  ] as const) {
    if (numerator > denominator) {
      context.addIssue({
        code: "custom",
        path: [path],
        message: "numerator cannot exceed denominator",
      });
    }
  }
});

export type EvaluationReport = z.infer<typeof evaluationReportSchema>;
export type EvaluationRunMetrics = z.infer<typeof evaluationRunMetricsSchema>;
export type ReviewerDecision = z.infer<typeof reviewerDecisionSchema>;

export type EvaluationCounts = {
  totalReports: number;
  reportsWithSixUsableModules: number;
  citedUrls: number;
  reachableCitationUrls: number;
  reviewedRelations: number;
  reviewerSupportedRelations: number;
  highConfidenceRisks: number;
  correctHighConfidenceRisks: number;
  reviewedReports: number;
  reportsPassingBothReviewersOrAdjudication: number;
  usableReportsIncludingExplicitSourceDegradation: number;
  firstModuleLatenciesMs: number[];
  baselineLatenciesMs: number[];
};

export type EvaluationScores = {
  structureCompleteness: number;
  validCitationRate: number;
  citationSupportRate: number;
  highConfidenceRiskPrecision: number;
  neutralityPassRate: number;
  reportSuccessRate: number;
  firstModuleP95Ms: number;
  baselineP95Ms: number;
};

export const evaluationThresholds = {
  structureCompleteness: 0.9,
  validCitationRate: 0.95,
  citationSupportRate: 0.85,
  highConfidenceRiskPrecision: 0.8,
  neutralityPassRate: 0.85,
  reportSuccessRate: 0.9,
  firstModuleP95Ms: 10_000,
  baselineP95Ms: 60_000,
} as const satisfies EvaluationScores;
