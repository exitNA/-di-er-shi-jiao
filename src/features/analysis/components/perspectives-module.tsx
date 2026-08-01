import type { PerspectivesModule as PerspectivesModuleData } from "@/features/analysis/domain/contracts";
import { StatementSection } from "./report-module";

export function PerspectivesModule({ data }: { data: PerspectivesModuleData }) {
  return (
    <>
      <StatementSection
        id="perspectives-supporting"
        section="supporting"
        title="支持观点"
        items={data.supporting}
      />
      <StatementSection
        id="perspectives-opposing"
        section="opposing"
        title="反对观点"
        items={data.opposing}
      />
      <StatementSection
        id="perspectives-stakeholders"
        section="stakeholders"
        title="主要利益相关者及其关切"
        items={data.stakeholders}
      />
      <StatementSection
        id="perspectives-disputes"
        section="disputes"
        title="争议焦点"
        items={data.disputes}
      />
      <StatementSection
        id="perspectives-unknowns"
        section="unknowns"
        title="尚未获得的信息"
        items={data.unknowns}
      />
      <StatementSection
        id="perspectives-change-evidence"
        section="changeEvidence"
        title="可能改变判断的新证据"
        items={data.changeEvidence}
      />
    </>
  );
}
