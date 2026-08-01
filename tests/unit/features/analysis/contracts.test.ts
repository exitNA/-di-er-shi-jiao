import { describe, expect, it } from "vitest";
import {
  argumentModuleSchema,
  baselineDraftSchema,
  externalSourceSchema,
  reportItemTargetSchema,
  resolveReportItemTarget,
  risksModuleSchema,
  sourcesModuleSchema,
  traceableStatementSchema,
} from "@/features/analysis/domain/contracts";
import * as analysisContracts from "@/features/analysis/domain/contracts";

const sourceMaterialStatement = {
  id: "statement-1",
  text: "原始材料中的事实",
  origin: "source_material" as const,
  sourceMaterialQuote: "原始材料中的事实",
  confidence: { score: 1, rationale: "直接引用原始材料" },
};

const baselineDraft = {
  overview: {
    coreClaims: [],
    mainDisputes: [],
    topRisks: [],
    keyUnknowns: [],
    safetyNotice: null,
  },
  argument: {
    factualOnly: true,
    claims: [],
    evidence: [],
    assumptions: [],
    reasoningSteps: [],
    conclusions: [],
    gaps: [],
    factualStatements: [],
  },
  perspectives: {
    supporting: [],
    opposing: [],
    stakeholders: [],
    disputes: [],
    unknowns: [],
    changeEvidence: [],
  },
  sources: { claims: [], sources: [], relations: [], gaps: [] },
  risks: { items: [] },
  reflection: { question: "还需要核实什么？", whyItMatters: "影响结论可靠性。" },
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

  it("rejects a baseline draft with an unknown module", () => {
    expect(() =>
      baselineDraftSchema.parse({ ...baselineDraft, unreviewed: { content: "未知模块" } }),
    ).toThrow();
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

  it("requires a stable ID for every risk item", () => {
    expect(() =>
      risksModuleSchema.parse({
        items: [
          {
            type: "overgeneralization",
            sourceMaterialQuote: "30 岁以后考公是获得稳定人生的唯一选择。",
            explanation: "以单一个例代替普遍规律",
            confidence: { score: 0.8, rationale: "范围超过证据" },
          },
        ],
      }),
    ).toThrow(/id/);
  });

  it("rejects duplicate risk IDs because a target must resolve uniquely", () => {
    const duplicate = {
      id: "risk-duplicate",
      type: "overgeneralization" as const,
      sourceMaterialQuote: "唯一选择。",
      explanation: "把单一选项扩大成唯一选项。",
      confidence: { score: 0.8, rationale: "存在绝对化表达" },
    };

    expect(() => risksModuleSchema.parse({ items: [duplicate, duplicate] })).toThrow(/id/);
  });

  it("resolves only one persisted report item for a target", () => {
    expect(typeof analysisContracts.resolveReportItemTarget).toBe("function");

    const modules = reportModules({
      risks: {
        items: [{
          id: "risk-1",
          type: "overgeneralization",
          sourceMaterialQuote: "唯一选择。",
          explanation: "把单一选项扩大成唯一选项。",
          confidence: { score: 0.8, rationale: "存在绝对化表达" },
        }],
      },
    });

    expect(resolveReportItemTarget(modules, {
      moduleType: "risks",
      section: "items",
      itemId: "risk-1",
    })).toBe(true);
    expect(resolveReportItemTarget(modules, {
      moduleType: "risks",
      section: "items",
      itemId: "risk-missing",
    })).toBe(false);
    expect(resolveReportItemTarget(modules, {
      moduleType: "risks",
      section: "unknown",
      itemId: "risk-1",
    })).toBe(false);
  });

  it("rejects a persisted target that resolves more than once", () => {
    const risk = {
      id: "risk-duplicate",
      type: "overgeneralization" as const,
      sourceMaterialQuote: "唯一选择。",
      explanation: "把单一选项扩大成唯一选项。",
      confidence: { score: 0.8, rationale: "存在绝对化表达" },
    };

    const modules = reportModules({ risks: { items: [] } });
    modules.risks.payload = { items: [risk, risk] };

    expect(resolveReportItemTarget(modules, {
      moduleType: "risks",
      section: "items",
      itemId: risk.id,
    })).toBe(false);
  });

  it("resolves a source relation by its unique claim and source pair", () => {
    const modules = reportModules({
      sources: {
        claims: [sourceMaterialStatement],
        sources: [{
          id: "source-1",
          title: "来源",
          url: "https://example.com/report",
          domain: "example.com",
          publisher: "Example",
          publishedAt: null,
          qualityTier: 2,
          excerpt: "摘要",
        }],
        relations: [{ claimId: "statement-1", sourceId: "source-1", relation: "supports" }],
        gaps: [],
      },
    });

    expect(resolveReportItemTarget(modules, {
      moduleType: "sources",
      section: "relations",
      itemId: "statement-1:source-1",
    })).toBe(true);
  });

  it("resolves a source relation when persisted IDs contain colons", () => {
    const claim = { ...sourceMaterialStatement, id: "statement:1" };
    const source = {
      id: "source:1",
      title: "来源",
      url: "https://example.com/report",
      domain: "example.com",
      publisher: "Example",
      publishedAt: null,
      qualityTier: 2,
      excerpt: "摘要",
    };
    const modules = reportModules({
      sources: {
        claims: [claim],
        sources: [source],
        relations: [{ claimId: claim.id, sourceId: source.id, relation: "supports" }],
        gaps: [],
      },
    });

    expect(resolveReportItemTarget(modules, {
      moduleType: "sources",
      section: "relations",
      itemId: `${claim.id}:${source.id}`,
    })).toBe(true);
  });

  it("rejects a report item target without its stable item ID", () => {
    expect(() =>
      reportItemTargetSchema.parse({
        moduleType: "risks",
        section: "items",
      }),
    ).toThrow(/itemId/);
  });
});

function reportModules(
  overrides: Partial<typeof baselineDraft>,
) {
  const draft = baselineDraftSchema.parse({ ...baselineDraft, ...overrides });
  return Object.fromEntries(
    Object.entries(draft).map(([moduleType, payload]) => [
      moduleType,
      { status: "completed", version: 1, payload },
    ]),
  ) as Parameters<typeof resolveReportItemTarget>[0];
}
