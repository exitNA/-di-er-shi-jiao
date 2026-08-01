"use client";

import { useState } from "react";

import type {
  AnalysisSnapshot,
  ArgumentModule,
  OverviewModule,
  PerspectivesModule,
  ReportItemTarget,
  RisksModule,
  TraceableStatement,
} from "@/features/analysis/domain/contracts";

type View = "观点" | "证据" | "未知";
type Finding = { label: string; text: string; target: ReportItemTarget; tone: string };

export function CurrentFindingsPanel({
  modules,
  selectedTarget,
  onSelect,
}: {
  modules: AnalysisSnapshot["modules"];
  selectedTarget?: ReportItemTarget;
  onSelect: (target: ReportItemTarget) => void;
}) {
  const [view, setView] = useState<View>("观点");
  const findings = buildFindings(modules, view);

  return <section className="flex h-full min-h-0 flex-col" aria-labelledby="current-findings-heading">
    <div className="flex items-start justify-between gap-4"><div><p className="font-mono text-xs font-medium tracking-[0.16em] text-secondary">LIVE MAP</p><h2 id="current-findings-heading" className="mt-2 font-display text-2xl font-semibold">观点地图</h2></div><p className="pt-5 text-xs text-ink-faint">选择节点继续追问</p></div>
    <div className="mt-5 flex gap-1 border-b border-border" role="tablist" aria-label="发现视图">{(["观点", "证据", "未知"] as const).map((item) => <button key={item} type="button" role="tab" aria-selected={view === item} onClick={() => setView(item)} className={`border-b-2 px-3 py-2 text-sm font-medium transition ${view === item ? "border-primary text-primary" : "border-transparent text-ink-faint hover:text-ink"}`}>{item}</button>)}</div>
    <div className="relative mt-4 min-h-[34rem] flex-1 overflow-hidden rounded-[1.75rem] border border-border bg-[radial-gradient(circle_at_center,_rgba(223,247,242,0.9),_transparent_44%),linear-gradient(#e4e4e055_1px,transparent_1px),linear-gradient(90deg,#e4e4e055_1px,transparent_1px)] bg-[size:auto,24px_24px,24px_24px] p-5">{findings.length ? <><div className="absolute left-1/2 top-1/2 h-px w-[70%] -translate-x-1/2 bg-secondary/25" /><div className="absolute left-1/2 top-1/2 h-[58%] w-px -translate-x-1/2 -translate-y-1/2 bg-secondary/20" /><div className="relative grid h-full grid-cols-2 content-center gap-x-8 gap-y-5 sm:grid-cols-3">{findings.slice(0, 6).map((finding, index) => <button key={`${finding.target.moduleType}-${finding.target.section}-${finding.target.itemId}`} type="button" onClick={() => onSelect(finding.target)} className={`relative min-h-28 rounded-2xl border p-4 text-left transition hover:-translate-y-1 hover:shadow-lg ${sameTarget(selectedTarget, finding.target) ? "border-secondary bg-mist shadow-md" : "border-white bg-white/90 hover:border-secondary/50"}`}><span className={`text-xs font-semibold ${finding.tone}`}>{finding.label}</span><p className="mt-2 line-clamp-3 text-sm leading-6 text-ink">{finding.text}</p><span className="absolute -top-2 -left-2 grid size-5 place-items-center rounded-full bg-primary text-[10px] text-white">{index + 1}</span></button>)}</div><p className="absolute bottom-5 left-5 text-xs text-ink-faint">Agent 会随新证据重排这张地图</p></> : <div className="grid h-full place-items-center text-center"><div><p className="text-sm font-medium text-ink">Agent 正在建立观点地图</p><p className="mt-2 max-w-xs text-sm leading-6 text-ink-faint">新的主张、证据或未知信息会在这里成为可讨论的节点。</p></div></div>}</div>
  </section>;
}

function buildFindings(modules: AnalysisSnapshot["modules"], view: View): Finding[] {
  const overview = modules.overview.payload as OverviewModule | undefined;
  const argument = modules.argument.payload as ArgumentModule | undefined;
  const perspectives = modules.perspectives.payload as PerspectivesModule | undefined;
  const risks = modules.risks.payload as RisksModule | undefined;
  if (view === "观点") return [...items("核心主张", overview?.coreClaims, "overview", "coreClaims", "text-primary"), ...items("论证主张", argument?.claims, "argument", "claims", "text-secondary"), ...items("支持视角", perspectives?.supporting, "perspectives", "supporting", "text-primary")];
  if (view === "证据") return [...items("支持论据", argument?.evidence, "argument", "evidence", "text-primary"), ...items("反对视角", perspectives?.opposing, "perspectives", "opposing", "text-secondary")];
  return [...items("主要争议", overview?.mainDisputes, "overview", "mainDisputes", "text-secondary"), ...items("关键未知", overview?.keyUnknowns, "overview", "keyUnknowns", "text-secondary"), ...items("证据缺口", argument?.gaps, "argument", "gaps", "text-secondary"), ...(risks?.items.map((item) => ({ label: "需要留意", text: item.explanation, target: { moduleType: "risks" as const, section: "items", itemId: item.id }, tone: "text-secondary" })) ?? [])];
}

function items(label: string, source: readonly TraceableStatement[] | undefined, moduleType: ReportItemTarget["moduleType"], section: string, tone: string): Finding[] {
  return (source ?? []).map((item) => ({ label, text: item.text, target: { moduleType, section, itemId: item.id }, tone }));
}

function sameTarget(left: ReportItemTarget | undefined, right: ReportItemTarget): boolean {
  return left?.moduleType === right.moduleType && left.section === right.section && left.itemId === right.itemId;
}
