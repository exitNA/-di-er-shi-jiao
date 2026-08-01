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
});
