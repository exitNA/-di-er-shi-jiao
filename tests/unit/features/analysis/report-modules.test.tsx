import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { ArgumentModule } from "@/features/analysis/components/argument-module";
import { ConfidenceMeter } from "@/features/analysis/components/confidence-meter";
import { RisksModule } from "@/features/analysis/components/risks-module";
import { SourcesModule } from "@/features/analysis/components/sources-module";
import { TraceabilityBadge } from "@/features/analysis/components/traceability-badge";
import type {
  ArgumentModule as ArgumentModuleData,
  RisksModule as RisksModuleData,
  SourcesModule as SourcesModuleData,
  TraceableStatement,
} from "@/features/analysis/domain/contracts";

const origins: TraceableStatement[] = [
  statement("source", "source_material"),
  statement("external", "external_source", "source-1"),
  statement("inference", "ai_inference"),
];

it("localizes traceability origins and renders confidence three ways", () => {
  render(
    <>
      {origins.map((item) => (
        <TraceabilityBadge key={item.id} origin={item.origin} />
      ))}
      <ConfidenceMeter
        confidence={{ score: 0.82, rationale: "证据与陈述高度匹配" }}
      />
    </>,
  );

  expect(screen.getByText("原文提取")).toBeInTheDocument();
  expect(screen.getByText("外部信源")).toBeInTheDocument();
  expect(screen.getByText("AI 推演")).toBeInTheDocument();
  expect(screen.getByText("82%")).toBeInTheDocument();
  expect(screen.getByText("高置信度")).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "置信度 82%" })).toHaveValue(82);
});

it("renders source relation metadata without a truth badge", () => {
  const data: SourcesModuleData = {
    claims: [origins[0]],
    sources: [
      {
        id: "source-1",
        title: "原始研究",
        url: "https://research.example/report",
        domain: "research.example",
        publisher: "示例研究院",
        publishedAt: null,
        qualityTier: 2,
        excerpt: "研究摘要",
      },
    ],
    relations: [
      { claimId: "source", sourceId: "source-1", relation: "challenges" },
    ],
    gaps: [],
  };
  render(<SourcesModule data={data} />);

  expect(screen.getByText("质疑")).toBeInTheDocument();
  expect(screen.getByText("示例研究院")).toBeInTheDocument();
  expect(screen.getByText("日期未提供")).toBeInTheDocument();
  expect(screen.getByText("research.example")).toBeInTheDocument();
  expect(screen.getByText("质量层级：2")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "原始研究" })).toHaveAttribute(
    "target",
    "_blank",
  );
  expect(screen.getByRole("link", { name: "原始研究" })).toHaveAttribute(
    "rel",
    "noreferrer",
  );
  expect(screen.queryByText(/真实|虚假/)).not.toBeInTheDocument();
});

it("uses factual-only argument copy and localizes all five risks", () => {
  const argument: ArgumentModuleData = {
    factualOnly: true,
    claims: [],
    evidence: [],
    assumptions: [],
    reasoningSteps: [],
    conclusions: [],
    gaps: [],
    factualStatements: [origins[0]],
  };
  const risks: RisksModuleData = {
    items: [
      "overgeneralization",
      "reversed_causality",
      "emotional_inducement",
      "concept_switching",
      "data_misleading",
    ].map((type) => ({
      type: type as RisksModuleData["items"][number]["type"],
      sourceMaterialQuote: "原文片段",
      explanation: "风险解释",
      confidence: { score: 0.6, rationale: "需要更多材料" },
    })),
  };
  render(
    <>
      <ArgumentModule data={argument} />
      <RisksModule data={risks} />
    </>,
  );

  expect(screen.getByText("当前内容以事实陈述为主")).toBeInTheDocument();
  for (const name of ["以偏概全", "因果倒置", "情绪诱导", "偷换概念", "数据误导"]) {
    expect(screen.getByRole("heading", { name })).toBeInTheDocument();
  }
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});

function statement(
  id: string,
  origin: TraceableStatement["origin"],
  sourceId?: string,
): TraceableStatement {
  return {
    id,
    text: `${id} 表述`,
    origin,
    ...(origin === "source_material"
      ? { sourceMaterialQuote: "原文片段" }
      : {}),
    ...(sourceId ? { sourceId } : {}),
    confidence: { score: 0.8, rationale: "测试依据" },
  };
}
