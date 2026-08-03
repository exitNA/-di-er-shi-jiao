import { perspectivesModuleSchema, type PerspectivesModule } from "@/features/analysis/domain/contracts";
import {
  draftReviewSchema,
  type DraftReview,
  type DraftReviewInput,
  type ExpertInput,
} from "../expert-suite";
import {
  createExpertHarness,
  type ExpertHarness,
  type ExpertSessionFactory,
  expertResourceDir,
  zodCompletionSchema,
} from "../shared/expert-harness";
import { loadPromptTemplate, sourceMaterial, systemInstruction, withDelegatedTask } from "../shared/prompt";

const perspectivesSystemInstruction = systemInstruction(loadPromptTemplate("perspectives/prompts/system"));
export const draftReviewSystemInstruction = systemInstruction(loadPromptTemplate("perspectives/prompts/draft-review"));

export function createPerspectivesExpert(createSession: ExpertSessionFactory): {
  mapPerspectives: ExpertHarness<PerspectivesModule>;
  reviewDraft: ExpertHarness<DraftReview>;
} {
  return {
    mapPerspectives: createExpertHarness({
      schema: perspectivesModuleSchema,
      completionSchema: zodCompletionSchema(perspectivesModuleSchema),
      createSession,
      resourceDir: expertResourceDir("perspectives"),
      systemPrompt: perspectivesSystemInstruction,
    }),
    reviewDraft: createExpertHarness({
      schema: draftReviewSchema,
      completionSchema: zodCompletionSchema(draftReviewSchema),
      createSession,
      resourceDir: expertResourceDir("perspectives"),
      systemPrompt: draftReviewSystemInstruction,
    }),
  };
}

export function mapPerspectives(harness: ExpertHarness<PerspectivesModule>, input: ExpertInput) {
  return harness.run({
    operation: "perspectives",
    systemPrompt: perspectivesSystemInstruction,
    prompt: withDelegatedTask(perspectivesPrompt(input.material), input.task),
    abortSignal: input.abortSignal,
  });
}

function perspectivesPrompt(material: string): string {
  return sourceMaterial(material);
}

function draftReviewPrompt(material: string, draft: unknown): string {
  return `${sourceMaterial(material)}\n\n${sourceMaterial(JSON.stringify(draft))}`;
}

export function reviewDraft(harness: ExpertHarness<DraftReview>, input: DraftReviewInput) {
  return harness.run({
    operation: "draft-review",
    systemPrompt: draftReviewSystemInstruction,
    prompt: draftReviewPrompt(input.material, input.draft),
    abortSignal: input.abortSignal,
  });
}
