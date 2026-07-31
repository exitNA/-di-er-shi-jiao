import { externalSource, loadPromptTemplate, sourceMaterial, systemInstruction } from "./common";

export type SourceCandidatePrompt = {
  id: string;
  title: string;
  url: string;
  domain: string;
  content: string;
  qualityTier: number;
};

export const sourcesSystemInstruction = systemInstruction(loadPromptTemplate("sources"));

export function sourcesPrompt(material: string, candidates: SourceCandidatePrompt[]): string {
  return `${sourceMaterial(material)}\n\n${candidates.map(externalSource).join("\n") || "<external_source>未找到合格网页内容。</external_source>"}\n\n请比较最多八个候选信源。`;
}
