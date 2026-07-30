import { describe, expect, it, vi } from "vitest";
import { baselineDraftSchema } from "@/features/analysis/domain/contracts";
import { FakeExpertSuite } from "@/server/agents/fake-expert-suite";

describe("FakeExpertSuite", () => {
  it("returns a deterministic, valid six-module draft based on the first sentence", async () => {
    const suite = new FakeExpertSuite({ delaysMs: { argument: 0, perspectives: 0, risks: 0, sources: 0 } });
    const material = "第一句是可追溯事实。第二句不应成为引文。";
    const [argument, perspectives, sources, risks] = await Promise.all([
      suite.analyzeArgument({ material }),
      suite.mapPerspectives({ material }),
      suite.researchSources({ material }),
      suite.reviewRisks({ material }),
    ]);
    const synthesis = await suite.synthesize({
      material,
      argument: argument.value,
      perspectives: perspectives.value,
      sources: sources.value,
      risks: risks.value,
    });
    const revised = await suite.reviseDraft({
      material,
      draft: { ...synthesis.value, argument: argument.value, perspectives: perspectives.value, sources: sources.value, risks: risks.value },
      findings: [],
    });

    expect(revised.value).toEqual(baselineDraftSchema.parse(revised.value));
    expect(revised.value.argument.claims[0]?.sourceMaterialQuote).toBe("第一句是可追溯事实。");
    expect(revised.value.sources.sources).toEqual([]);
    expect(revised.value.reflection.question).toBeTruthy();
  });

  it("supports configured expert failures and delays", async () => {
    vi.useFakeTimers();
    const suite = new FakeExpertSuite({ delaysMs: { sources: 50 }, failures: { sources: "SEARCH_UNAVAILABLE" } });
    const pending = suite.researchSources({ material: "可追溯事实。" });

    await vi.advanceTimersByTimeAsync(50);
    await expect(pending).rejects.toMatchObject({ code: "SEARCH_UNAVAILABLE" });
    vi.useRealTimers();
  });
});
