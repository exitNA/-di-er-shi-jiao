import type { ReflectionModule as ReflectionModuleData } from "@/features/analysis/domain/contracts";

export function ReflectionModule({ data }: { data: ReflectionModuleData }) {
  return (
    <div className="rounded-lg bg-neutral-50 p-5">
      <h3 className="text-lg font-medium">{data.question}</h3>
      <p className="mt-3 leading-7 text-neutral-600">{data.whyItMatters}</p>
    </div>
  );
}
