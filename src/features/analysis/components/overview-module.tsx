import type { OverviewModule as OverviewModuleData } from "@/features/analysis/domain/contracts";
import { StatementSection } from "./report-module";

export function OverviewModule({ data }: { data: OverviewModuleData }) {
  return (
    <>
      <StatementSection
        id="overview-core-claims"
        title="核心主张"
        items={data.coreClaims}
      />
      <StatementSection
        id="overview-main-disputes"
        title="主要争议"
        items={data.mainDisputes}
      />
      <StatementSection
        id="overview-top-risks"
        title="最高优先级认知风险"
        items={data.topRisks}
      />
      <StatementSection
        id="overview-key-unknowns"
        title="关键未知信息"
        items={data.keyUnknowns}
      />
      {data.safetyNotice ? (
        <aside className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h3 className="font-medium">安全提示</h3>
          <p className="mt-2 leading-7">{data.safetyNotice}</p>
        </aside>
      ) : null}
    </>
  );
}
