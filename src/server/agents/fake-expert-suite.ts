import {
  baselineDraftSchema,
  type ArgumentModule,
  type BaselineDraft,
  type OverviewModule,
  type PerspectivesModule,
  type ReflectionModule,
  type RisksModule,
  type SourcesModule,
  type TraceableStatement,
} from "@/features/analysis/domain/contracts";
import type {
  DraftReview,
  DraftReviewInput,
  DraftRevisionInput,
  ExpertInput,
  ExpertResult,
  ExpertSuite,
  SynthesisInput,
} from "./expert-suite";

type ExpertName = "argument" | "perspectives" | "sources" | "risks";

type FakeExpertSuiteOptions = {
  delaysMs?: Partial<Record<ExpertName, number>>;
  failures?: Partial<Record<ExpertName, string>>;
};

const defaultDelays: Record<ExpertName, number> = {
  argument: 20,
  perspectives: 30,
  risks: 40,
  sources: 500,
};

const fakeUsage = { inputTokens: 0, outputTokens: 0, latencyMs: 0 };

export class FakeExpertSuite implements ExpertSuite {
  private readonly delays: Record<ExpertName, number>;
  private readonly sourceAttempts = new Map<string, number>();
  private readonly armedInterruptions = new Set<string>();
  private readonly consumedInterruptions = new Set<string>();

  constructor(private readonly options: FakeExpertSuiteOptions = {}) {
    this.delays = { ...defaultDelays, ...options.delaysMs };
  }

  async analyzeArgument(input: ExpertInput): Promise<ExpertResult<ArgumentModule>> {
    await this.run("argument", input);
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
  }

  async mapPerspectives(input: ExpertInput): Promise<ExpertResult<PerspectivesModule>> {
    await this.run("perspectives", input);
    const source = sourceStatement(input.material);
    return result({
      supporting: [source],
      opposing: [inference("perspective-opposing", "还应检查与该主张不一致的证据。")],
      stakeholders: [inference("perspective-stakeholder", "受影响方的利益与成本需要分别核实。")],
      disputes: [inference("perspective-dispute", "争议在于主张是否得到足够证据支持。")],
      unknowns: [inference("perspective-unknown", "材料没有交代样本范围和比较对象。")],
      changeEvidence: [inference("perspective-change", "独立原始数据可能改变目前判断。")],
    });
  }

  async researchSources(input: ExpertInput): Promise<ExpertResult<SourcesModule>> {
    await this.run("sources", input);
    return result({
      claims: [sourceStatement(input.material)],
      sources: [],
      relations: [],
      gaps: [inference("sources-gap", "暂无外部信源；获取更多证据：查找官方原始数据或同行评审研究。")],
    });
  }

  async reviewRisks(input: ExpertInput): Promise<ExpertResult<RisksModule>> {
    await this.run("risks", input);
    const quote = firstSentence(input.material);
    return result({
      items: quote
        ? [
            {
              type: "overgeneralization",
              sourceMaterialQuote: quote,
              explanation: "单句材料不足以支持广泛结论。",
              confidence: { score: 0.7, rationale: "需要核对样本与反例" },
            },
          ]
        : [],
    });
  }

  async synthesize(input: SynthesisInput): Promise<ExpertResult<{ overview: OverviewModule; reflection: ReflectionModule }>> {
    const source = sourceStatement(input.material);
    return result({
      overview: {
        coreClaims: [source],
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
  }

  async reviewDraft(_input: DraftReviewInput): Promise<ExpertResult<DraftReview>> {
    return result({ findings: [] });
  }

  async reviseDraft(input: DraftRevisionInput): Promise<ExpertResult<BaselineDraft>> {
    return result(baselineDraftSchema.parse(input.draft));
  }

  private async run(expert: ExpertName, input: ExpertInput): Promise<void> {
    await delay(this.delays[expert], input.abortSignal);
    const failure = this.options.failures?.[expert];
    if (failure) throw codedError(failure);
    if (
      expert === "sources" &&
      isTestScenario() &&
      input.material.startsWith("[测试：信源失败一次]")
    ) {
      const attempts = this.sourceAttempts.get(input.material) ?? 0;
      this.sourceAttempts.set(input.material, attempts + 1);
      if (attempts === 0) throw codedError("SEARCH_UNAVAILABLE");
    }
    if (isTestScenario() && input.material.startsWith("[测试：任务中断]")) {
      if (expert === "argument" && !this.consumedInterruptions.has(input.material)) {
        this.armedInterruptions.add(input.material);
      }
      if (expert === "perspectives" && this.armedInterruptions.delete(input.material)) {
        this.consumedInterruptions.add(input.material);
        throw codedError("TASK_INTERRUPTED");
      }
    }
  }
}

function isTestScenario(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.E2E_TEST_MODE === "true";
}

function result<T>(value: T): ExpertResult<T> {
  return { value, usage: fakeUsage };
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
  return material.match(/^\s*(.*?[。！？!?]|.+$)/)?.[1].trim() ?? "";
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}
