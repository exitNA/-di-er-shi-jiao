import { sourceMaterial, systemInstruction } from "./common";

export const risksSystemInstruction = systemInstruction(
  "仅识别五类认知风险：过度概括、因果倒置、情绪诱导、概念切换、数据误导。每一项必须附材料中的精确引文；没有精确引文就不要输出该项。",
);

export function risksPrompt(material: string): string {
  return `${sourceMaterial(material)}\n\n请进行高层次风险审查。`;
}
