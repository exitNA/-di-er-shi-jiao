import {
  baselineDraftSchema,
  type BaselineDraft,
  type OverviewModule,
  type ReflectionModule,
} from "@/features/analysis/domain/contracts";
import {
  targetedReviewSchema,
  type TargetedReview,
  type TargetedReviewInput,
} from "@/features/conversation/domain/contracts";
import {
  synthesisOutputSchema,
  type DraftRevisionInput,
  type SynthesisInput,
} from "../expert-suite";
import {
  createExpertHarness,
  type ExpertHarness,
  type ExpertSessionFactory,
  expertResourceDir,
  zodCompletionSchema,
} from "../shared/expert-harness";
import { loadPromptTemplate, sourceMaterial, systemInstruction, withDelegatedTask } from "../shared/prompt";

const synthesisSystemInstruction = systemInstruction(loadPromptTemplate("synthesis/prompts/system"));
const draftRevisionSystemInstruction = systemInstruction(loadPromptTemplate("synthesis/prompts/draft-revision"));
const targetedReviewSystemInstruction = systemInstruction(loadPromptTemplate("synthesis/prompts/targeted-review"));

type SynthesisOutput = { overview: OverviewModule; reflection: ReflectionModule };

export function createSynthesisExpert(createSession: ExpertSessionFactory): {
  synthesize: ExpertHarness<SynthesisOutput>;
  reviseDraft: ExpertHarness<BaselineDraft>;
} {
  return {
    synthesize: createExpertHarness({
      schema: synthesisOutputSchema,
      completionSchema: zodCompletionSchema(synthesisOutputSchema),
      createSession,
      resourceDir: expertResourceDir("synthesis"),
      systemPrompt: synthesisSystemInstruction,
    }),
    reviseDraft: createExpertHarness({
      schema: baselineDraftSchema,
      completionSchema: zodCompletionSchema(baselineDraftSchema),
      createSession,
      resourceDir: expertResourceDir("synthesis"),
      systemPrompt: draftRevisionSystemInstruction,
    }),
  };
}

export function createTargetedReviewExpert(
  createSession: ExpertSessionFactory,
  input: TargetedReviewInput,
): ExpertHarness<TargetedReview> {
  const schema = targetedReviewSchema(
    input.target.moduleType,
    new Set(input.newSources?.map((source) => source.id)),
  );
  return createExpertHarness({
    schema,
    completionSchema: zodCompletionSchema(schema),
    createSession,
    resourceDir: expertResourceDir("synthesis"),
    systemPrompt: targetedReviewSystemInstruction,
  });
}

export function synthesize(
  harness: ExpertHarness<SynthesisOutput>,
  input: SynthesisInput,
) {
  return harness.run({
    operation: "synthesis",
    systemPrompt: synthesisSystemInstruction,
    prompt: withDelegatedTask(synthesisPrompt(input.material, expertOutputs(input)), input.task),
    abortSignal: input.abortSignal,
  });
}

function synthesisPrompt(material: string, outputs: unknown): string {
  return `${sourceMaterial(material)}\n\n${sourceMaterial(JSON.stringify(outputs))}`;
}

export function reviseDraft(harness: ExpertHarness<BaselineDraft>, input: DraftRevisionInput) {
  return harness.run({
    operation: "draft-revision",
    systemPrompt: draftRevisionSystemInstruction,
    prompt: `${synthesisPrompt(input.material, expertOutputs(input))}\n\n${sourceMaterial(JSON.stringify(input.draft))}\n\n${sourceMaterial(JSON.stringify(input.findings))}`,
    abortSignal: input.abortSignal,
  });
}

export function reviewTarget(
  harness: ExpertHarness<TargetedReview>,
  input: TargetedReviewInput,
) {
  return harness.run({
    operation: "targeted-review",
    systemPrompt: targetedReviewSystemInstruction,
    prompt: `${sourceMaterial(input.material)}\n\n${sourceMaterial(JSON.stringify({
      target: input.target,
      currentModule: input.currentModule,
      conversation: input.conversation,
      persistedSources: input.newSources ?? [],
    }))}`,
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
