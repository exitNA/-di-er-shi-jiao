import { describe, expect, it } from "vitest";
import {
  argumentModuleSchema,
  externalSourceSchema,
  risksModuleSchema,
  sourcesModuleSchema,
  traceableStatementSchema,
} from "@/features/analysis/domain/contracts";

const sourceMaterialStatement = {
  id: "statement-1",
  text: "原始材料中的事实",
  origin: "source_material" as const,
  sourceMaterialQuote: "原始材料中的事实",
  confidence: { score: 1, rationale: "直接引用原始材料" },
};

describe("analysis report contracts", () => {
  it("rejects an untraced critical statement", () => {
    expect(() =>
      traceableStatementSchema.parse({
        id: "claim-1",
        text: "唯一选择",
        origin: "external_source",
        confidence: { score: 0.8, rationale: "有外部资料" },
      }),
    ).toThrow(/sourceId/);
  });

  it("rejects a source-material claim without its exact quote", () => {
    expect(() =>
      traceableStatementSchema.parse({
        id: "claim-1",
        text: "原始材料中的事实",
        origin: "source_material",
        confidence: { score: 1, rationale: "直接引用原始材料" },
      }),
    ).toThrow(/sourceMaterialQuote/);
  });

  it("accepts a factual-only argument module", () => {
    expect(
      argumentModuleSchema.parse({
        factualOnly: true,
        claims: [],
        evidence: [],
        assumptions: [],
        reasoningSteps: [],
        conclusions: [],
        gaps: [],
        factualStatements: [sourceMaterialStatement],
      }),
    ).toBeTruthy();
  });

  it("requires complete external-source metadata", () => {
    expect(() =>
      externalSourceSchema.parse({
        id: "source-1",
        title: "来源",
        url: "not-a-url",
        domain: "example.com",
        publisher: "示例出版社",
        publishedAt: null,
        qualityTier: 2,
        excerpt: "摘要",
      }),
    ).toThrow();
  });

  it("limits source relations to their declared meanings", () => {
    expect(() =>
      sourcesModuleSchema.parse({
        claims: [sourceMaterialStatement],
        sources: [],
        relations: [{ claimId: "statement-1", sourceId: "source-1", relation: "proves" }],
        gaps: [],
      }),
    ).toThrow();
  });

  it("requires an exact quote for every risk item", () => {
    expect(() =>
      risksModuleSchema.parse({
        items: [
          {
            type: "overgeneralization",
            explanation: "以单一个例代替普遍规律",
            confidence: { score: 0.8, rationale: "范围超过证据" },
          },
        ],
      }),
    ).toThrow(/sourceMaterialQuote/);
  });
});
