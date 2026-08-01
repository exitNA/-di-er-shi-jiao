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
      argument: argument.value,
      perspectives: perspectives.value,
      sources: sources.value,
      risks: risks.value,
      draft: { ...synthesis.value, argument: argument.value, perspectives: perspectives.value, sources: sources.value, risks: risks.value },
      findings: [],
    });

    expect(revised.value).toEqual(baselineDraftSchema.parse(revised.value));
    expect(revised.value.argument.claims[0]?.sourceMaterialQuote).toBe("第一句是可追溯事实。");
    expect(revised.value.sources.sources).toEqual([]);
    expect(revised.value.risks.items[0]?.id).toBe("risk-overgeneralization");
    expect(revised.value.reflection.question).toBeTruthy();
  });

  it("supports configured expert failures and delays", async () => {
    vi.useFakeTimers();
    const suite = new FakeExpertSuite({ delaysMs: { sources: 50 }, failures: { sources: "SEARCH_UNAVAILABLE" } });
    const pending = suite.researchSources({ material: "可追溯事实。" });
    const rejection = expect(pending).rejects.toMatchObject({ code: "SEARCH_UNAVAILABLE" });

    await vi.advanceTimersByTimeAsync(50);
    await rejection;
    vi.useRealTimers();
  });

  it("fails the source marker once and then recovers", async () => {
    const suite = new FakeExpertSuite({ delaysMs: { sources: 0 } });
    const input = { material: "[测试：信源失败一次]可追溯事实。" };

    await expect(suite.researchSources(input)).rejects.toMatchObject({ code: "SEARCH_UNAVAILABLE" });
    await expect(suite.researchSources(input)).resolves.toMatchObject({ value: { sources: [] } });
  });

  it("emits one interruption signal and does not retain failures for recovery", async () => {
    const suite = new FakeExpertSuite({ delaysMs: { argument: 0, perspectives: 0, risks: 0, sources: 0 } });
    const input = { material: "[测试：任务中断]可追溯事实。" };

    await suite.analyzeArgument(input);
    await expect(suite.mapPerspectives(input)).rejects.toMatchObject({ code: "TASK_INTERRUPTED" });
    await expect(suite.reviewRisks(input)).resolves.toBeTruthy();
    await expect(suite.researchSources(input)).resolves.toBeTruthy();
    await suite.analyzeArgument(input);
    await expect(suite.mapPerspectives(input)).resolves.toBeTruthy();
  });
});
