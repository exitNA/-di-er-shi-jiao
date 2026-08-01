import { z } from "zod";

import {
  argumentModuleSchema,
  overviewModuleSchema,
  perspectivesModuleSchema,
  reflectionModuleSchema,
  risksModuleSchema,
  sourcesModuleSchema,
} from "@/features/analysis/domain/contracts";
import type {
  BaselineDraft,
  ConversationMessage,
  ExternalSource,
  ReportItemTarget,
  ReportModuleType,
} from "@/features/analysis/domain/contracts";

export type TargetedReviewInput = {
  material: string;
  target: ReportItemTarget;
  currentModule: BaselineDraft[ReportModuleType];
  conversation: ConversationMessage[];
  newSources?: ExternalSource[];
  abortSignal?: AbortSignal;
};

export type TargetedReview = {
  responseText: string;
  replacement?: {
    module: BaselineDraft[ReportModuleType];
    reason: string;
    newEvidenceSourceIds: string[];
    summary: string;
  };
};

export type RevisionRunResult =
  | { status: "completed"; revisionId?: string }
  | { status: "running" }
  | { status: "recoverable" }
  | { status: "not-found" };

export function targetedReviewSchema(
  moduleType: ReportModuleType,
  allowedEvidenceSourceIds: ReadonlySet<string>,
): z.ZodType<TargetedReview> {
  const moduleSchemas: Record<ReportModuleType, z.ZodType<BaselineDraft[ReportModuleType]>> = {
    overview: overviewModuleSchema,
    argument: argumentModuleSchema,
    perspectives: perspectivesModuleSchema,
    sources: sourcesModuleSchema,
    risks: risksModuleSchema,
    reflection: reflectionModuleSchema,
  };
  return z.object({
    responseText: z.string().min(1),
    replacement: z.object({
      module: moduleSchemas[moduleType],
      reason: z.string().min(1),
      newEvidenceSourceIds: z.array(z.string().min(1)),
      summary: z.string().min(1),
    }).strict().optional(),
  }).strict().superRefine((value, context) => {
    const replacementSources = moduleType === "sources" && value.replacement
      ? sourcesModuleSchema.safeParse(value.replacement.module)
      : undefined;
    const replacementSourceIds = new Set(
      replacementSources?.success
        ? replacementSources.data.sources.map((source) => source.id)
        : [],
    );
    value.replacement?.newEvidenceSourceIds.forEach((sourceId, index) => {
      if (!allowedEvidenceSourceIds.has(sourceId) && !replacementSourceIds.has(sourceId)) {
        context.addIssue({
          code: "custom",
          path: ["replacement", "newEvidenceSourceIds", index],
          message: "evidence source must already belong to the report",
        });
      }
    });
  });
}
