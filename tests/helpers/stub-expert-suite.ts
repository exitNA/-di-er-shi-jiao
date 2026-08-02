import type {
  RisksModule,
  TraceableStatement,
} from "@/features/analysis/domain/contracts";
import type { TargetedReview } from "@/features/conversation/domain/contracts";
import type {
  ExpertResult,
  ExpertSuite,
} from "@/server/agents/expert-suite";

const usage = { inputTokens: 0, outputTokens: 0, latencyMs: 0 };

export function createStubExpertSuite(
  overrides: Partial<ExpertSuite> = {},
): ExpertSuite {
  return {
    async analyzeArgument(input) {
      const source = sourceStatement(input.material);
      return result({
        factualOnly: input.factualOnly ?? false,
        claims: [source],
        evidence: [source],
        assumptions: [inference("argument-assumption", "材料未提供完整的比较条件。")],
        reasoningSteps: [inference("argument-reasoning", "需要将主张与可核实证据逐项对应。")],
        conclusions: [inference("argument-conclusion", "现有材料不足以确定结论。")],
        gaps: [inference("argument-gap", "需要补充来源、时间范围与反例。")],
        factualStatements: [source],
      });
    },
    async researchSources(input) {
      return result({
        claims: [sourceStatement(input.material)],
        sources: [],
        relations: [],
        gaps: [inference("sources-gap", "暂无外部信源，需要补充官方数据或同行评审研究。")],
      });
    },
    async mapPerspectives(input) {
      const source = sourceStatement(input.material);
      return result({
        supporting: [source],
        opposing: [inference("perspective-opposing", "还应检查与该主张不一致的证据。")],
        stakeholders: [inference("perspective-stakeholder", "受影响方的利益与成本需要分别核实。")],
        disputes: [inference("perspective-dispute", "争议在于主张是否得到足够证据支持。")],
        unknowns: [inference("perspective-unknown", "材料没有交代样本范围和比较对象。")],
        changeEvidence: [inference("perspective-change", "独立原始数据可能改变目前判断。")],
      });
    },
    async reviewRisks(input) {
      return result({
        items: [{
          id: "risk-overgeneralization",
          type: "overgeneralization",
          sourceMaterialQuote: firstSentence(input.material),
          explanation: "单句材料不足以支持广泛结论。",
          confidence: { score: 0.7, rationale: "需要核对样本与反例" },
        }],
      });
    },
    async synthesize(input) {
      return result({
        overview: {
          coreClaims: [sourceStatement(input.material)],
          mainDisputes: input.perspectives.disputes,
          topRisks: [inference("overview-risk", "结论可能超出可用证据。")],
          keyUnknowns: input.perspectives.unknowns,
          safetyNotice: null,
        },
        reflection: {
          question: "还需要哪些独立证据来检验这一主张？",
          whyItMatters: "独立证据能区分材料陈述与可靠结论。",
        },
      });
    },
    async reviewDraft() {
      return result({ findings: [] });
    },
    async reviseDraft(input) {
      return result(structuredClone(input.draft));
    },
    async reviewTarget(input) {
      const replacementModule = input.target.moduleType === "risks"
        ? {
            items: (input.currentModule as RisksModule).items.filter(
              (item) => item.id !== input.target.itemId,
            ),
          }
        : input.currentModule;
      return result<TargetedReview>({
        responseText: "复核后，这项质疑成立，报告已更新。",
        replacement: {
          module: replacementModule,
          reason: "原结论超出当前材料能够支持的范围。",
          newEvidenceSourceIds: input.newSources?.map((source) => source.id) ?? [],
          summary: "按质疑结果更新目标条目。",
        },
      });
    },
    ...overrides,
  };
}

function result<T>(value: T): ExpertResult<T> {
  return { value, usage };
}

function sourceStatement(material: string): TraceableStatement {
  const quote = firstSentence(material) || "未提供可引用的原文。";
  return {
    id: "material-1",
    text: quote,
    origin: "source_material",
    sourceMaterialQuote: quote,
    confidence: { score: 1, rationale: "直接摘自提交素材" },
  };
}

function inference(id: string, text: string): TraceableStatement {
  return {
    id,
    text,
    origin: "ai_inference",
    confidence: { score: 0.7, rationale: "基于当前材料的有限推演" },
  };
}

function firstSentence(material: string): string {
  return material.match(/^\s*(.*?[。！？!?]|.+$)/)?.[1].trim() ?? "未提供可引用的原文。";
}
