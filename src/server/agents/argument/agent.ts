import { argumentModuleSchema } from "@/features/analysis/domain/contracts";
import type { StructuredGenerator } from "@/server/ai/structured-generator";
import type { ExpertInput } from "../expert-suite";
import { loadPromptTemplate, sourceMaterial, systemInstruction } from "../shared/prompt";

const argumentSystemInstruction = systemInstruction(loadPromptTemplate("argument/prompts/system"));
const factualArgumentSystemInstruction = systemInstruction(loadPromptTemplate("argument/prompts/factual-system"));

export function analyzeArgument(generator: StructuredGenerator, input: ExpertInput) {
  return generator.generate({
    operation: "argument",
    system: input.factualOnly ? factualArgumentSystemInstruction : argumentSystemInstruction,
    prompt: argumentPrompt(input.material),
    schema: argumentModuleSchema,
    abortSignal: input.abortSignal,
  });
}

function argumentPrompt(material: string): string {
  return sourceMaterial(material);
}
