import { risksModuleSchema, type RisksModule } from "@/features/analysis/domain/contracts";
import type { StructuredGenerator } from "@/server/ai/structured-generator";
import type { ExpertInput, ExpertResult } from "../expert-suite";
import { loadPromptTemplate, sourceMaterial, systemInstruction } from "../shared/prompt";

const risksSystemInstruction = systemInstruction(loadPromptTemplate("risks/prompts/system"));

export async function reviewRisks(
  generator: StructuredGenerator,
  input: ExpertInput,
): Promise<ExpertResult<RisksModule>> {
  const generated = await generator.generate({
    operation: "risks",
    system: risksSystemInstruction,
    prompt: risksPrompt(input.material),
    schema: risksModuleSchema,
    abortSignal: input.abortSignal,
  });

  return {
    ...generated,
    value: { items: generated.value.items.filter((item) => input.material.includes(item.sourceMaterialQuote)) },
  };
}

function risksPrompt(material: string): string {
  return sourceMaterial(material);
}
