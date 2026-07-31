import type { TraceableStatement } from "@/features/analysis/domain/contracts";

const labels: Record<TraceableStatement["origin"], string> = {
  source_material: "原文提取",
  external_source: "外部信源",
  ai_inference: "AI 推演",
};

export function TraceabilityBadge({
  origin,
}: {
  origin: TraceableStatement["origin"];
}) {
  return (
    <span className="inline-flex rounded-full border border-neutral-300 px-2 py-0.5 text-xs font-medium">
      {labels[origin]}
    </span>
  );
}
