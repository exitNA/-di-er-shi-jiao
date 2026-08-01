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
import { RevisionHistory } from "@/features/conversation/components/revision-history";
import { AgentWorkspaceLayout } from "./agent-workspace-layout";
import { CurrentFindingsPanel } from "./current-findings-panel";

const disclaimer =
  "本报告由 AI 生成，旨在提供多角度思考框架。请核对引用，并结合自身知识独立判断。";

function AgentActivity({ modules }: { modules: AnalysisSnapshot["modules"] }) {
  const steps = [
    ["拆解原文观点", modules.overview.status],
    ["核对论据与隐含假设", modules.argument.status],
    ["寻找不同立场", modules.perspectives.status],
  ] as const;
  return <div className="mt-5 space-y-4"><div className="max-w-[92%] rounded-2xl rounded-tl-sm bg-forest-soft px-4 py-3 text-sm leading-6 text-ink"><p className="mb-1 text-xs font-semibold text-primary">第二视角 Agent</p>我先把这段内容拆成可以验证的观点，再找出支持它、挑战它的证据。</div><div className="space-y-2">{steps.map(([label, status], index) => <details key={label} open={status === "running"} className="group rounded-xl border border-border bg-white/70"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm"><span className="flex items-center gap-2"><span className="grid size-5 place-items-center rounded-md bg-forest-soft text-xs font-medium text-primary">{index + 1}</span>{label}</span><span className={`shrink-0 rounded-full px-2 py-1 text-xs ${status === "completed" ? "bg-forest-soft text-primary" : status === "running" ? "bg-mist text-secondary" : "bg-neutral-100 text-ink-faint"}`}>{status === "completed" ? "已完成" : status === "running" ? "进行中" : "等待中"}</span></summary>{status !== "queued" ? <p className="border-t border-border px-3 py-2 text-xs leading-5 text-ink-faint">{status === "completed" ? "已写入右侧观点地图，可选择节点继续追问。" : "正在比较原文表述与已有推断。"}</p> : null}</details>)}</div></div>;
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
    <main className="min-h-[calc(100vh-5rem)] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1440px]">
        <header className="mb-6 flex items-end justify-between gap-4">
          <div><p className="font-mono text-xs font-medium tracking-[0.16em] text-secondary">第二视角 · 工作台</p><h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">与第二视角一起推理</h1></div>
          <p className="hidden text-sm text-ink-faint sm:block">{connectionText}</p>
        </header>
        <AgentWorkspaceLayout
          conversation={<div className="flex h-full flex-col rounded-[1.5rem] border border-border bg-white/75 p-5 shadow-sm sm:p-6"><div className="flex items-center gap-2 text-sm font-medium text-primary"><Sparkles size={16} aria-hidden="true" />{progressText}</div><div className="mt-4 ml-auto max-w-[92%] rounded-2xl rounded-tr-sm bg-primary px-4 py-3 text-sm leading-7 text-white"><p className="mb-1 text-xs font-semibold text-white/70">你</p>{snapshot.materialPreview}</div><AgentActivity modules={snapshot.modules} /><div className="mt-5 min-h-0 flex-1"><ConversationPanel jobId={snapshot.jobId} messages={snapshot.messages} selectedTarget={selectedTarget} onRefresh={refreshSnapshot} /></div><div className="mt-4"><RevisionHistory revisions={snapshot.revisions} modules={snapshot.modules} /></div></div>}
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
        />
      </div>
    </main>
  );
}
