import { loadPromptTemplate, sourceMaterial, systemInstruction } from "./common";

export const synthesisSystemInstruction = systemInstruction(loadPromptTemplate("synthesis"));

export function synthesisPrompt(material: string, outputs: unknown): string {
  return `${sourceMaterial(material)}\n\n${sourceMaterial(JSON.stringify(outputs))}`;
}
