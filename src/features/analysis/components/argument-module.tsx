import type { ArgumentModule as ArgumentModuleData } from "@/features/analysis/domain/contracts";
import { StatementSection } from "./report-module";

export function ArgumentModule({ data }: { data: ArgumentModuleData }) {
  if (data.factualOnly) {
    return (
      <>
        <p className="rounded-lg bg-neutral-100 p-4 font-medium">
          当前内容以事实陈述为主
        </p>
        <StatementSection
          id="argument-factual-statements"
          title="可识别的事实陈述"
          items={data.factualStatements}
        />
        <StatementSection
          id="argument-factual-gaps"
          title="待核实信息"
          items={data.gaps}
        />
      </>
    );
  }

  return (
    <>
      <StatementSection id="argument-claims" title="核心主张" items={data.claims} />
      <StatementSection
        id="argument-evidence"
        title="支持论据"
        items={data.evidence}
      />
      <StatementSection
        id="argument-assumptions"
        title="隐藏假设"
        items={data.assumptions}
      />
      <StatementSection
        id="argument-reasoning"
        title="中间推理"
        items={data.reasoningSteps}
      />
      <StatementSection
        id="argument-conclusions"
        title="最终结论"
        items={data.conclusions}
      />
      <StatementSection
        id="argument-gaps"
        title="缺失或跳跃"
        items={data.gaps}
      />
    </>
  );
}
