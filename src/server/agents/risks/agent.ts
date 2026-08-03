import { risksModuleSchema, type RisksModule } from "@/features/analysis/domain/contracts";
import type { ExpertInput, ExpertResult } from "../expert-suite";
import {
  createExpertHarness,
  type ExpertHarness,
  type ExpertSessionFactory,
  zodCompletionSchema,
} from "../shared/expert-harness";
import { loadPromptTemplate, sourceMaterial, systemInstruction } from "../shared/prompt";

const risksSystemInstruction = systemInstruction(loadPromptTemplate("risks/prompts/system"));

export function createRisksExpert(createSession: ExpertSessionFactory): ExpertHarness<RisksModule> {
  return createExpertHarness({
    schema: risksModuleSchema,
    completionSchema: zodCompletionSchema(risksModuleSchema),
    createSession,
  });
}

export async function reviewRisks(
  harness: ExpertHarness<RisksModule>,
  input: ExpertInput,
): Promise<ExpertResult<RisksModule>> {
  const generated = await harness.run({
    operation: "risks",
    system: risksSystemInstruction,
    prompt: risksPrompt(input.material),
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
