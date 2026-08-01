import {
  resolveReportItemTarget,
  type AnalysisSnapshot,
  type ReportItemTarget,
  type ReportRevision,
} from "@/features/analysis/domain/contracts";

const moduleLabels: Record<ReportItemTarget["moduleType"], string> = {
  overview: "速览",
  argument: "论证骨架",
  perspectives: "多视角地图",
  sources: "信源对照",
  risks: "认知风险",
  reflection: "思考对话",
};

const sectionLabels: Record<string, string> = {
  items: "风险条目",
  relations: "信源关系",
  coreClaims: "核心主张",
  mainDisputes: "主要争议",
  topRisks: "最高优先级认知风险",
  keyUnknowns: "关键未知信息",
  claims: "核心主张",
  evidence: "支持论据",
  assumptions: "隐藏假设",
  reasoningSteps: "中间推理",
  conclusions: "最终结论",
  gaps: "证据缺口",
  factualStatements: "事实陈述",
  supporting: "支持观点",
  opposing: "反对观点",
  stakeholders: "利益相关者",
  disputes: "争议焦点",
  unknowns: "未知信息",
  changeEvidence: "改变判断的证据",
};

export function reportItemAnchorId(target: ReportItemTarget): string {
  return `report-item-${target.moduleType}-${encodeURIComponent(target.section)}-${encodeURIComponent(target.itemId)}`;
}

export function reportTargetLabel(target: ReportItemTarget): string {
  return `${moduleLabels[target.moduleType]} / ${sectionLabels[target.section] ?? target.section} / ${target.itemId}`;
}

export function RevisionHistory({
  revisions = [],
  modules,
}: {
  revisions?: readonly ReportRevision[];
  modules?: AnalysisSnapshot["modules"];
}) {
  return (
    <section
      className="rounded-[1.5rem] border border-border bg-white/75 p-5 shadow-sm sm:p-6"
      aria-labelledby="revision-history-heading"
    >
      <h3 id="revision-history-heading" className="font-display text-2xl font-semibold">
        修订记录
      </h3>
      {revisions.length ? (
        <ul className="mt-4 space-y-4">
          {revisions.flatMap((revision) =>
            revision.changes.map((change, index) => {
              const anchorId =
                modules && !resolveReportItemTarget(modules, change.target)
                  ? `report-module-${change.target.moduleType}`
                  : reportItemAnchorId(change.target);
              return (
                <li
                  key={`${revision.id}-${index}`}
                  className="rounded-2xl bg-apricot/25 p-4 text-sm leading-6"
                >
                  <a
                    className="font-medium underline"
                    href={`#${encodeURIComponent(anchorId)}`}
                    onClick={() => document.getElementById(anchorId)?.focus()}
                  >
                    {reportTargetLabel(change.target)}
                  </a>
                  <p className="mt-2">{change.summary}</p>
                  <p>修订理由：{change.reason}</p>
                  <p>
                    新增证据：
                    {change.newEvidenceSourceIds.length
                      ? change.newEvidenceSourceIds.join("、")
                      : "无"}
                  </p>
                </li>
              );
            }),
          )}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-ink-faint">报告尚无修订。</p>
      )}
    </section>
  );
}
