"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ArgumentModule } from "./argument-module";
import { OverviewModule } from "./overview-module";
import { PerspectivesModule } from "./perspectives-module";
import { ReflectionModule } from "./reflection-module";
import { ReportModule } from "./report-module";
import { RisksModule } from "./risks-module";
import { SourcesModule } from "./sources-module";
import {
  moduleTypes,
  type AnalysisSnapshot,
  type ArgumentModule as ArgumentModuleData,
  type OverviewModule as OverviewModuleData,
  type PerspectivesModule as PerspectivesModuleData,
  type ReflectionModule as ReflectionModuleData,
  type RisksModule as RisksModuleData,
  type SourcesModule as SourcesModuleData,
  type ReportItemTarget,
} from "@/features/analysis/domain/contracts";
import { useAnalysisStream } from "@/features/analysis/hooks/use-analysis-stream";
import { ConversationPanel } from "@/features/conversation/components/conversation-panel";
import { AgentWorkspaceLayout } from "./agent-workspace-layout";
import { CurrentFindingsPanel } from "./current-findings-panel";

const disclaimer =
  "本报告由 AI 生成，旨在提供多角度思考框架。请核对引用，并结合自身知识独立判断。";

function CurrentAction({ modules }: { modules: AnalysisSnapshot["modules"] }) {
  const active = moduleTypes.find((moduleType) => modules[moduleType].status === "running");
  const label = active ? { overview: "正在整理观点", argument: "正在核对论据", perspectives: "正在比较立场", sources: "正在核查信源", risks: "正在识别风险", reflection: "正在生成追问" }[active] : "分析已完成";
  return <p className="mt-5 text-sm text-ink-faint"><span className="mr-2 inline-block size-2 rounded-full bg-secondary" />{label}</p>;
}

export function AnalysisWorkspace({
  initialSnapshot,
}: {
  initialSnapshot: AnalysisSnapshot;
}) {
  const { snapshot, connectionState, retryModule, refreshSnapshot } =
    useAnalysisStream(initialSnapshot.jobId, initialSnapshot);
  const [selectedTarget, setSelectedTarget] = useState<ReportItemTarget>();
  const completed = Object.values(snapshot.modules).filter(
    (module) => module.status === "completed",
  ).length;
  const firstModuleEventJobId = useRef<string | null>(null);
  useEffect(() => {
    const moduleType = moduleTypes.find(
      (candidate) => snapshot.modules[candidate].status === "completed",
    );
    if (!moduleType || firstModuleEventJobId.current === snapshot.jobId) return;
    firstModuleEventJobId.current = snapshot.jobId;
    void fetch(
      "/api/product-events",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventName: "first_module_shown",
          jobId: snapshot.jobId,
          moduleType,
        }),
        keepalive: true,
      },
    ).catch(() => {});
  }, [snapshot.jobId, snapshot.modules]);
  const progressText =
    snapshot.status === "completed"
      ? "分析已更新"
      : snapshot.status === "partial"
        ? `正在补全发现 · 已整理 ${completed} 项`
      : snapshot.status === "recoverable"
        ? "分析暂时中断，等待恢复"
        : "第二视角正在整理线索";
  const connectionText = {
    connecting: "正在连接实时更新",
    connected: "实时更新已连接",
    polling: "实时连接暂不可用，正在定时刷新",
    closed: "更新已结束",
  }[connectionState];
  const overview = snapshot.modules.overview;
  const argument = snapshot.modules.argument;
  const perspectives = snapshot.modules.perspectives;
  const sources = snapshot.modules.sources;
  const risks = snapshot.modules.risks;
  const reflection = snapshot.modules.reflection;
  return (
    <main className="h-[calc(100dvh-4.5rem)] overflow-hidden px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex h-full w-full max-w-[1440px] min-h-0 flex-col">
        <header className="mb-6 flex items-end justify-between gap-4">
          <div><p className="font-mono text-xs font-medium tracking-[0.16em] text-secondary">第二视角 · 工作台</p><h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">与第二视角一起推理</h1></div>
          <p className="hidden text-sm text-ink-faint sm:block">{connectionText}</p>
        </header>
        <div className="min-h-0 flex-1"><AgentWorkspaceLayout
          conversation={<div className="flex h-full flex-col rounded-[1.5rem] border border-border bg-white/75 p-5 shadow-sm sm:p-6"><div className="flex items-center gap-2 text-sm font-medium text-primary"><Sparkles size={16} aria-hidden="true" />{progressText}</div><div className="mt-5 ml-auto max-w-[92%] rounded-2xl rounded-tr-sm bg-primary px-4 py-3 text-sm leading-7 text-white"><p className="mb-1 text-xs font-semibold text-white/70">你</p>{snapshot.materialPreview}</div><CurrentAction modules={snapshot.modules} /><div className="mt-6 min-h-0 flex-1"><ConversationPanel jobId={snapshot.jobId} messages={snapshot.messages} selectedTarget={selectedTarget} onRefresh={refreshSnapshot} /></div></div>}
          findings={<><CurrentFindingsPanel modules={snapshot.modules} selectedTarget={selectedTarget} onSelect={setSelectedTarget} /><section className="hidden" aria-labelledby="legacy-findings-heading"><div className="space-y-4">
          <ReportModule
            id="report-module-overview"
            moduleType="overview"
            title="速览"
            status={overview.status}
            onChallenge={setSelectedTarget}
          >
            {overview.payload ? (
              <OverviewModule data={overview.payload as OverviewModuleData} />
            ) : undefined}
          </ReportModule>
          <ReportModule
            id="report-module-argument"
            moduleType="argument"
            title="论证骨架"
            status={argument.status}
            onRetry={() => retryModule("argument")}
            onChallenge={setSelectedTarget}
          >
            {argument.payload ? (
              <ArgumentModule data={argument.payload as ArgumentModuleData} />
            ) : undefined}
          </ReportModule>
          <ReportModule
            id="report-module-perspectives"
            moduleType="perspectives"
            title="多视角地图"
            status={perspectives.status}
            onRetry={() => retryModule("perspectives")}
            onChallenge={setSelectedTarget}
          >
            {perspectives.payload ? (
              <PerspectivesModule
                data={perspectives.payload as PerspectivesModuleData}
              />
            ) : undefined}
          </ReportModule>
          <ReportModule
            id="report-module-sources"
            moduleType="sources"
            title="信源对照"
            status={sources.status}
            onRetry={() => retryModule("sources")}
            onChallenge={setSelectedTarget}
          >
            {sources.payload ? (
              <SourcesModule data={sources.payload as SourcesModuleData} />
            ) : undefined}
          </ReportModule>
          <ReportModule
            id="report-module-risks"
            moduleType="risks"
            title="认知风险"
            status={risks.status}
            onRetry={() => retryModule("risks")}
            onChallenge={setSelectedTarget}
          >
            {risks.payload ? (
              <RisksModule data={risks.payload as RisksModuleData} />
            ) : undefined}
          </ReportModule>
          <ReportModule
            id="report-module-reflection"
            moduleType="reflection"
            title="思考对话"
            status={reflection.status}
            onChallenge={setSelectedTarget}
          >
            {reflection.payload ? (
              <ReflectionModule
                data={reflection.payload as ReflectionModuleData}
              />
            ) : undefined}
          </ReportModule>
          <p className="rounded-xl bg-forest-soft px-4 py-3 text-xs leading-5 text-ink-faint">{disclaimer}</p></div></section></>}
        /></div>
      </div>
    </main>
  );
}
