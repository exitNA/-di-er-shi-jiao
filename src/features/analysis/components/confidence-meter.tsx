import type { TraceableStatement } from "@/features/analysis/domain/contracts";

type Confidence = TraceableStatement["confidence"];

export function ConfidenceMeter({ confidence }: { confidence: Confidence }) {
  const percentage = Math.round(confidence.score * 100);
  const label =
    confidence.score >= 0.8
      ? "高置信度"
      : confidence.score >= 0.5
        ? "中等置信度"
        : "低置信度";

  return (
    <div className="mt-3 grid gap-1 text-sm text-neutral-600">
      <div className="flex flex-wrap items-center gap-2">
        <span>置信度</span>
        <span className="font-medium text-neutral-900">{percentage}%</span>
        <span>{label}</span>
      </div>
      <progress
        className="h-2 w-full"
        aria-label={`置信度 ${percentage}%`}
        max={100}
        value={percentage}
      />
      <p>{confidence.rationale}</p>
    </div>
  );
}
