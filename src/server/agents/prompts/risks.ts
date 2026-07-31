import { loadPromptTemplate, sourceMaterial, systemInstruction } from "./common";

export const risksSystemInstruction = systemInstruction(loadPromptTemplate("risks"));

export function risksPrompt(material: string): string {
  return `${sourceMaterial(material)}\n\n请进行高层次风险审查。`;
}
