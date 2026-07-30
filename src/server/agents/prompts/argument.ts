import { sourceMaterial, systemInstruction } from "./common";

export const argumentSystemInstruction = systemInstruction(
  "识别主张、证据、假设、推理步骤、结论与缺口。只有材料直接陈述的内容可标为原文提取；其余分析标为 AI 推演。",
);

export function argumentPrompt(material: string, factualOnly = false): string {
  return `${sourceMaterial(material)}\n\n${factualOnly ? "仅提取可核对事实，不推演立场。" : "分析论证结构并保留不确定性。"}`;
}
