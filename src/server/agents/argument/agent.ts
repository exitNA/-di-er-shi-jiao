import { argumentModuleSchema, type ArgumentModule } from "@/features/analysis/domain/contracts";
import type { ExpertInput } from "../expert-suite";
import {
  createExpertHarness,
  type ExpertHarness,
  type ExpertSessionFactory,
  zodCompletionSchema,
} from "../shared/expert-harness";
import { loadPromptTemplate, sourceMaterial, systemInstruction } from "../shared/prompt";

const argumentSystemInstruction = systemInstruction(loadPromptTemplate("argument/prompts/system"));
const factualArgumentSystemInstruction = systemInstruction(loadPromptTemplate("argument/prompts/factual-system"));

export function createArgumentExpert(createSession: ExpertSessionFactory): ExpertHarness<ArgumentModule> {
  return createExpertHarness({
    schema: argumentModuleSchema,
    completionSchema: zodCompletionSchema(argumentModuleSchema),
    createSession,
  });
}

export function analyzeArgument(harness: ExpertHarness<ArgumentModule>, input: ExpertInput) {
  return harness.run({
    operation: "argument",
    system: input.factualOnly ? factualArgumentSystemInstruction : argumentSystemInstruction,
    prompt: argumentPrompt(input.material),
    abortSignal: input.abortSignal,
  });
}

function argumentPrompt(material: string): string {
  return sourceMaterial(material);
}
