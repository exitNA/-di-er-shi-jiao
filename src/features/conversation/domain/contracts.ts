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
