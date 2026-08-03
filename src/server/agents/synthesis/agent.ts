import { baselineDraftSchema } from "@/features/analysis/domain/contracts";
import {
  targetedReviewSchema,
  type TargetedReviewInput,
} from "@/features/conversation/domain/contracts";
import type { StructuredGenerator } from "@/server/ai/structured-generator";
import {
  synthesisOutputSchema,
  type DraftRevisionInput,
  type SynthesisInput,
} from "../expert-suite";
import { loadPromptTemplate, sourceMaterial, systemInstruction } from "../shared/prompt";

const synthesisSystemInstruction = systemInstruction(loadPromptTemplate("synthesis/prompts/system"));
const draftRevisionSystemInstruction = systemInstruction(loadPromptTemplate("synthesis/prompts/draft-revision"));
const targetedReviewSystemInstruction = systemInstruction(loadPromptTemplate("synthesis/prompts/targeted-review"));

export function synthesize(generator: StructuredGenerator, input: SynthesisInput) {
  return generator.generate({
    operation: "synthesis",
    system: synthesisSystemInstruction,
    prompt: synthesisPrompt(input.material, expertOutputs(input)),
    schema: synthesisOutputSchema,
    abortSignal: input.abortSignal,
  });
}

function synthesisPrompt(material: string, outputs: unknown): string {
  return `${sourceMaterial(material)}\n\n${sourceMaterial(JSON.stringify(outputs))}`;
}

export function reviseDraft(generator: StructuredGenerator, input: DraftRevisionInput) {
  return generator.generate({
    operation: "draft-revision",
    system: draftRevisionSystemInstruction,
    prompt: `${synthesisPrompt(input.material, expertOutputs(input))}\n\n${sourceMaterial(JSON.stringify(input.draft))}\n\n${sourceMaterial(JSON.stringify(input.findings))}`,
    schema: baselineDraftSchema,
    abortSignal: input.abortSignal,
  });
}

export function reviewTarget(generator: StructuredGenerator, input: TargetedReviewInput) {
  return generator.generate({
    operation: "targeted-review",
    system: targetedReviewSystemInstruction,
    prompt: `${sourceMaterial(input.material)}\n\n${sourceMaterial(JSON.stringify({
      target: input.target,
      currentModule: input.currentModule,
      conversation: input.conversation,
      persistedSources: input.newSources ?? [],
    }))}`,
    schema: targetedReviewSchema(
      input.target.moduleType,
      new Set(input.newSources?.map((source) => source.id)),
    ),
    abortSignal: input.abortSignal,
  });
}

function expertOutputs(input: SynthesisInput | DraftRevisionInput) {
  return {
    argument: input.argument,
    perspectives: input.perspectives,
    sources: input.sources,
    risks: input.risks,
  };
}
