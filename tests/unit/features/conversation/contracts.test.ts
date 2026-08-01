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

  it("accepts evidence metadata introduced by a sources replacement", () => {
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

    expect(schema.safeParse({
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
    }).success).toBe(true);
  });
});
