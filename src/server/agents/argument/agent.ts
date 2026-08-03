import { argumentModuleSchema, type ArgumentModule } from "@/features/analysis/domain/contracts";
import type { ExpertInput } from "../expert-suite";
import {
  createExpertHarness,
  type ExpertHarness,
  type ExpertSessionFactory,
  expertResourceDir,
  zodCompletionSchema,
} from "../shared/expert-harness";
import { loadPromptTemplate, sourceMaterial, systemInstruction, withDelegatedTask } from "../shared/prompt";

const argumentSystemInstruction = systemInstruction(loadPromptTemplate("argument/prompts/system"));
const factualArgumentSystemInstruction = systemInstruction(loadPromptTemplate("argument/prompts/factual-system"));

export function createArgumentExpert(createSession: ExpertSessionFactory): ExpertHarness<ArgumentModule> {
  return createExpertHarness({
    schema: argumentModuleSchema,
    completionSchema: zodCompletionSchema(argumentModuleSchema),
    createSession,
    resourceDir: expertResourceDir("argument"),
    systemPrompt: argumentSystemInstruction,
  });
}

export function analyzeArgument(harness: ExpertHarness<ArgumentModule>, input: ExpertInput) {
  return harness.run({
    operation: "argument",
    systemPrompt: input.factualOnly ? factualArgumentSystemInstruction : argumentSystemInstruction,
    prompt: withDelegatedTask(argumentPrompt(input.material), input.task),
    abortSignal: input.abortSignal,
  });
}

function argumentPrompt(material: string): string {
  return sourceMaterial(material);
}
