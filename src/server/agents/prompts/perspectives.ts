import { sourceMaterial, systemInstruction } from "./common";

export const perspectivesSystemInstruction = systemInstruction(
  "分别呈现支持与反对视角、受影响方、关键争议、未知信息与会改变结论的证据。审查草稿时只报告单边表述、无依据主张、遗漏争议或可追溯性缺口。",
);

export function perspectivesPrompt(material: string): string {
  return `${sourceMaterial(material)}\n\n请建立多视角对照。`;
}

export function draftReviewPrompt(material: string, draft: unknown): string {
  return `${sourceMaterial(material)}\n\n<draft>${JSON.stringify(draft)}</draft>\n\n请审查草稿并只返回需要修改的发现。`;
}
