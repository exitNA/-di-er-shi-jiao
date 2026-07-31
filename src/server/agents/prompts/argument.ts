import { loadPromptTemplate, sourceMaterial, systemInstruction } from "./common";

export const argumentSystemInstruction = systemInstruction(loadPromptTemplate("argument"));

export function argumentPrompt(material: string, factualOnly = false): string {
  return `${sourceMaterial(material)}\n\n${factualOnly ? "仅提取可核对事实，不推演立场。" : "分析论证结构并保留不确定性。"}`;
}
