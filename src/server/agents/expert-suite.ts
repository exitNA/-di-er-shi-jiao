import type {
  ArgumentModule,
  BaselineDraft,
  OverviewModule,
  PerspectivesModule,
  ReflectionModule,
  ReportModuleType,
  RisksModule,
  SourcesModule,
} from "@/features/analysis/domain/contracts";
import type { GenerationUsage } from "@/server/ai/structured-generator";

export type ExpertInput = {
  material: string;
  factualOnly?: boolean;
  abortSignal?: AbortSignal;
};

export type ExpertOutputs = Pick<BaselineDraft, "argument" | "perspectives" | "sources" | "risks">;

export type SynthesisInput = ExpertInput & ExpertOutputs;

export type DraftReview = {
  findings: Array<{
    moduleType: ReportModuleType;
    statementId?: string;
    problem: string;
    requiredChange: string;
  }>;
};

export type DraftReviewInput = ExpertInput & { draft: BaselineDraft };

export type DraftRevisionInput = ExpertInput & {
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
}
