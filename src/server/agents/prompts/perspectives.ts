import { loadPromptTemplate, sourceMaterial, systemInstruction } from "./common";

export const perspectivesSystemInstruction = systemInstruction(loadPromptTemplate("perspectives"));

export function perspectivesPrompt(material: string): string {
  return `${sourceMaterial(material)}\n\n请建立多视角对照。`;
}

export function draftReviewPrompt(material: string, draft: unknown): string {
  return `${sourceMaterial(material)}\n\n${sourceMaterial(JSON.stringify(draft))}\n\n请审查草稿并只返回需要修改的发现。`;
}
