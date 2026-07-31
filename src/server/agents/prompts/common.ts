import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const promptDirectory = join(process.cwd(), "prompts");

export function loadPromptTemplate(name: string): string {
  return readFileSync(join(promptDirectory, `${name}.md`), "utf8").trim();
}

export const commonSystemInstruction = loadPromptTemplate("common");

export function systemInstruction(task: string): string {
  return `${commonSystemInstruction}\n\n${task}`;
}

export function sourceMaterial(material: string): string {
  return `<source_material>${escapeBoundaryText(material)}</source_material>`;
}

export function externalSource(input: { id: string; title: string; url: string; domain: string; content: string }): string {
  return `<external_source id="${escapeAttribute(input.id)}" title="${escapeAttribute(input.title)}" url="${escapeAttribute(input.url)}" domain="${escapeAttribute(input.domain)}">${escapeBoundaryText(input.content)}</external_source>`;
}

function escapeBoundaryText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeBoundaryText(value).replace(/"/g, "&quot;");
}
