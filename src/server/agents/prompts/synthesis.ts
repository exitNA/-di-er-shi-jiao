import { sourceMaterial, systemInstruction } from "./common";

export const synthesisSystemInstruction = systemInstruction(
  "综合四位独立专家的结果，只生成 overview 与 reflection。概览必须保留争议、风险和未知，反思必须提出一个有助于继续核实的问题。",
);

export function synthesisPrompt(material: string, outputs: unknown): string {
  return `${sourceMaterial(material)}\n\n${sourceMaterial(JSON.stringify(outputs))}`;
}
