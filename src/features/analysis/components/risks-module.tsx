import type { RisksModule as RisksModuleData } from "@/features/analysis/domain/contracts";
import { ConfidenceMeter } from "./confidence-meter";

const riskLabels: Record<RisksModuleData["items"][number]["type"], string> = {
  overgeneralization: "以偏概全",
  reversed_causality: "因果倒置",
  emotional_inducement: "情绪诱导",
  concept_switching: "偷换概念",
  data_misleading: "数据误导",
};

export function RisksModule({ data }: { data: RisksModuleData }) {
  if (!data.items.length) {
    return <p className="text-neutral-600">当前没有具备完整证据的风险条目。</p>;
  }

  return (
    <ul className="space-y-4">
      {data.items.map((item, index) => (
        <li
          key={`${item.type}-${index}`}
          id={`risk-${item.type}-${index}`}
          className="rounded-lg bg-neutral-50 p-4"
        >
          <h3 className="text-lg font-medium">{riskLabels[item.type]}</h3>
          <blockquote className="mt-3 border-l-2 border-neutral-300 pl-3 text-neutral-600">
            {item.sourceMaterialQuote}
          </blockquote>
          <p className="mt-3 leading-7">{item.explanation}</p>
          <ConfidenceMeter confidence={item.confidence} />
        </li>
      ))}
    </ul>
  );
}
