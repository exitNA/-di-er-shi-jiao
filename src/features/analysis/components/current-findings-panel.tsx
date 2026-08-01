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
    <div className="flex items-start justify-between gap-4"><div><p className="font-mono text-xs font-medium tracking-[0.16em] text-secondary">CURRENT OUTPUT</p><h2 id="current-findings-heading" className="mt-2 font-display text-2xl font-semibold">当前发现</h2></div><p className="pt-5 text-xs text-ink-faint">选择一项追问</p></div>
    <div className="mt-5 flex gap-1 border-b border-border" role="tablist" aria-label="发现视图">{(["观点", "证据", "未知"] as const).map((item) => <button key={item} type="button" role="tab" aria-selected={view === item} onClick={() => setView(item)} className={`border-b-2 px-3 py-2 text-sm font-medium transition ${view === item ? "border-primary text-primary" : "border-transparent text-ink-faint hover:text-ink"}`}>{item}</button>)}</div>
    <div className="mt-2 min-h-0 flex-1 divide-y divide-border overflow-y-auto">{findings.length ? findings.map((finding) => <button key={`${finding.target.moduleType}-${finding.target.section}-${finding.target.itemId}`} type="button" onClick={() => onSelect(finding.target)} className={`w-full px-1 py-5 text-left transition ${sameTarget(selectedTarget, finding.target) ? "bg-forest-soft/60 px-4" : "hover:bg-forest-soft/35"}`}><p className={`text-xs font-semibold ${finding.tone}`}>{finding.label}</p><p className="mt-2 leading-7 text-ink">{finding.text}</p></button>) : <p className="py-8 text-sm leading-6 text-ink-faint">暂时还没有可展示的发现。</p>}</div>
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
