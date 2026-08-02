import { z } from "zod";
import type {
  ArgumentModule,
  BaselineDraft,
  OverviewModule,
  PerspectivesModule,
  ReflectionModule,
  RisksModule,
  SourcesModule,
} from "@/features/analysis/domain/contracts";
import type { GenerationUsage } from "@/server/ai/structured-generator";
import type {
  TargetedReview,
  TargetedReviewInput,
} from "@/features/conversation/domain/contracts";
import { workspaceDraftReviewSchema } from "@/features/analysis/domain/workspace";
import {
  overviewModuleSchema,
  reflectionModuleSchema,
} from "@/features/analysis/domain/contracts";

export type ExpertInput = {
  material: string;
  factualOnly?: boolean;
  abortSignal?: AbortSignal;
};

export type ExpertOutputs = Pick<BaselineDraft, "argument" | "perspectives" | "sources" | "risks">;

export type SynthesisInput = ExpertInput & ExpertOutputs;

export const draftReviewSchema = workspaceDraftReviewSchema;

export const synthesisOutputSchema = z.object({
  overview: overviewModuleSchema,
  reflection: reflectionModuleSchema,
});

export type DraftReview = z.infer<typeof draftReviewSchema>;

export type DraftReviewInput = ExpertInput & { draft: BaselineDraft };

export type DraftRevisionInput = ExpertInput & ExpertOutputs & {
  draft: BaselineDraft;
  findings: DraftReview["findings"];
};

export type ExpertResult<T> = { value: T; usage: GenerationUsage };

export interface ExpertSuite {
  analyzeArgument(input: ExpertInput): Promise<ExpertResult<ArgumentModule>>;
  mapPerspectives(input: ExpertInput): Promise<ExpertResult<PerspectivesModule>>;
  researchSources(input: ExpertInput): Promise<ExpertResult<SourcesModule>>;
  reviewRisks(input: ExpertInput): Promise<ExpertResult<RisksModule>>;
  synthesize(input: SynthesisInput): Promise<ExpertResult<{ overview: OverviewModule; reflection: ReflectionModule }>>;
  reviewDraft(input: DraftReviewInput): Promise<ExpertResult<DraftReview>>;
  reviseDraft(input: DraftRevisionInput): Promise<ExpertResult<BaselineDraft>>;
  reviewTarget(input: TargetedReviewInput): Promise<ExpertResult<TargetedReview>>;
}
