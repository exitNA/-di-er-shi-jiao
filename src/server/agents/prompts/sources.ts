import { externalSource, sourceMaterial, systemInstruction } from "./common";

export type SourceCandidatePrompt = {
  id: string;
  title: string;
  url: string;
  domain: string;
  content: string;
  qualityTier: number;
};

export const sourcesSystemInstruction = systemInstruction(
  "比较候选外部信源与材料中的主张。优先选择 3 至 5 个独立、高质量信源；仅当合格信源不足时可选 0 至 2 个，并在 gaps 中说明证据不足及获取更多证据的方向。不要编造信源。",
);

export function sourcesPrompt(material: string, candidates: SourceCandidatePrompt[]): string {
  return `${sourceMaterial(material)}\n\n${candidates.map(externalSource).join("\n") || "<external_source>未找到合格网页内容。</external_source>"}\n\n请比较最多八个候选信源。`;
}
