import { perspectivesModuleSchema } from "@/features/analysis/domain/contracts";
import type { StructuredGenerator } from "@/server/ai/structured-generator";
import {
  draftReviewSchema,
  type DraftReviewInput,
  type ExpertInput,
} from "../expert-suite";
import { loadPromptTemplate, sourceMaterial, systemInstruction } from "../shared/prompt";

const perspectivesSystemInstruction = systemInstruction(loadPromptTemplate("perspectives/prompts/system"));
export const draftReviewSystemInstruction = systemInstruction(loadPromptTemplate("perspectives/prompts/draft-review"));

export function mapPerspectives(generator: StructuredGenerator, input: ExpertInput) {
  return generator.generate({
    operation: "perspectives",
    system: perspectivesSystemInstruction,
    prompt: perspectivesPrompt(input.material),
    schema: perspectivesModuleSchema,
    abortSignal: input.abortSignal,
  });
}

function perspectivesPrompt(material: string): string {
  return sourceMaterial(material);
}

function draftReviewPrompt(material: string, draft: unknown): string {
  return `${sourceMaterial(material)}\n\n${sourceMaterial(JSON.stringify(draft))}`;
}

export function reviewDraft(generator: StructuredGenerator, input: DraftReviewInput) {
  return generator.generate({
    operation: "draft-review",
    system: draftReviewSystemInstruction,
    prompt: draftReviewPrompt(input.material, input.draft),
    schema: draftReviewSchema,
    abortSignal: input.abortSignal,
  });
}
