import { describe, expect, it } from "vitest";

import * as conversationContracts from "@/features/conversation/domain/contracts";

describe("targeted review contract", () => {
  it("provides a schema that can constrain revision evidence IDs", () => {
    expect(typeof conversationContracts.targetedReviewSchema).toBe("function");
    const schema = conversationContracts.targetedReviewSchema(
      "risks",
      new Set(["source-persisted"]),
    );
    const output = {
      responseText: "复核完成。",
      replacement: {
        module: { items: [] },
        reason: "证据发生变化。",
        newEvidenceSourceIds: ["source-hallucinated"],
        summary: "更新风险。",
      },
    };

    expect(schema.safeParse(output).success).toBe(false);
    expect(schema.safeParse({
      ...output,
      replacement: {
        ...output.replacement,
        newEvidenceSourceIds: ["source-persisted"],
      },
    }).success).toBe(true);
  });

  it("rejects evidence metadata introduced by a sources replacement", () => {
    const schema = conversationContracts.targetedReviewSchema("sources", new Set());
    const newSource = {
      id: "source-new",
      title: "新来源",
      url: "https://example.com/new",
      domain: "example.com",
      publisher: "Example",
      publishedAt: null,
      qualityTier: 2,
      excerpt: "新证据摘要",
    };

    const output = {
      responseText: "新来源支持本次修订。",
      replacement: {
        module: {
          claims: [],
          sources: [newSource],
          relations: [],
          gaps: [],
        },
        reason: "补充新证据。",
        newEvidenceSourceIds: [newSource.id],
        summary: "更新来源。",
      },
    };

    expect(schema.safeParse(output).success).toBe(false);
    expect(schema.safeParse({
      ...output,
      replacement: { ...output.replacement, newEvidenceSourceIds: [] },
    }).success).toBe(false);
  });

  it("rejects undeclared non-persisted source references in replacement content", () => {
    const schema = conversationContracts.targetedReviewSchema(
      "overview",
      new Set(["source-persisted"]),
    );
    const externalClaim = {
      id: "claim-1",
      text: "LLM 引用了未持久化来源。",
      origin: "external_source" as const,
      sourceId: "source-hallucinated",
      confidence: { score: 0.8, rationale: "声称来自外部来源" },
    };

    expect(schema.safeParse({
      responseText: "复核完成。",
      replacement: {
        module: {
          coreClaims: [externalClaim],
          mainDisputes: [],
          topRisks: [],
          keyUnknowns: [],
          safetyNotice: null,
        },
        reason: "引用外部来源。",
        newEvidenceSourceIds: [],
        summary: "更新主张。",
      },
    }).success).toBe(false);
  });
});
