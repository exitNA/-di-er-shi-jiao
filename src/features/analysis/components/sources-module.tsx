import type {
  ExternalSource,
  SourcesModule as SourcesModuleData,
} from "@/features/analysis/domain/contracts";
import { ConfidenceMeter } from "./confidence-meter";
import { ReportChallengeButton, StatementSection } from "./report-module";
import { TraceabilityBadge } from "./traceability-badge";
import { reportItemAnchorId } from "@/features/conversation/components/revision-history";

const relationLabels: Record<
  SourcesModuleData["relations"][number]["relation"],
  string
> = {
  supports: "支持",
  challenges: "质疑",
  insufficient: "信息不足",
};

export function SourcesModule({ data }: { data: SourcesModuleData }) {
  return (
    <>
      <section aria-labelledby="source-relations-heading">
        <h3 id="source-relations-heading" className="text-lg font-medium">
          主张与信源关系
        </h3>
        {data.relations.length ? (
          <ul className="mt-3 space-y-4">
            {data.relations.map((relation, index) => {
              const claim = data.claims.find(
                (item) => item.id === relation.claimId,
              );
              const source = data.sources.find(
                (item) => item.id === relation.sourceId,
              );
              if (!claim || !source) return null;

              return (
                <li
                  key={`${relation.claimId}-${relation.sourceId}-${index}`}
                  id={reportItemAnchorId({
                    moduleType: "sources",
                    section: "relations",
                    itemId: `${relation.claimId}:${relation.sourceId}`,
                  })}
                  tabIndex={-1}
                  className="rounded-lg bg-neutral-50 p-4"
                >
                  <p className="leading-7">{claim.text}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <TraceabilityBadge origin={claim.origin} />
                    <span className="font-medium">
                      {relationLabels[relation.relation]}
                    </span>
                  </div>
                  <ConfidenceMeter confidence={claim.confidence} />
                  <SourceLink source={source} />
                  <ReportChallengeButton
                    section="relations"
                    itemId={`${relation.claimId}:${relation.sourceId}`}
                    label="质疑：信源关系"
                  />
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-neutral-600">
            当前没有可用的外部信源关系。
          </p>
        )}
      </section>
      <StatementSection id="source-gaps" title="证据缺口" items={data.gaps} />
    </>
  );
}

function SourceLink({ source }: { source: ExternalSource }) {
  return (
    <div className="mt-4 border-t border-neutral-200 pt-4 text-sm">
      <a
        className="font-medium underline"
        href={source.url}
        target="_blank"
        rel="noreferrer"
      >
        {source.title}
      </a>
      <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-neutral-600">
        <div>
          <dt className="sr-only">发布者</dt>
          <dd>{source.publisher}</dd>
        </div>
        <div>
          <dt className="sr-only">发布日期</dt>
          <dd>{source.publishedAt?.slice(0, 10) ?? "日期未提供"}</dd>
        </div>
        <div>
          <dt className="sr-only">来源域名</dt>
          <dd>{source.domain}</dd>
        </div>
        <div>
          <dt className="sr-only">质量层级</dt>
          <dd>质量层级：{source.qualityTier}</dd>
        </div>
      </dl>
    </div>
  );
}
