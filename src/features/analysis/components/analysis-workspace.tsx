"use client";

import { Compass, Radio } from "lucide-react";
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

const disclaimer =
  "本报告由 AI 生成，旨在提供多角度思考框架。请核对引用，并结合自身知识独立判断。";

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
      ? "认知体检已完成"
      : snapshot.status === "partial"
        ? `认知体检部分完成，已完成 ${completed} / 6 个模块`
      : snapshot.status === "recoverable"
        ? `认知体检待恢复，已完成 ${completed} / 6 个模块`
        : `认知体检生成中，已完成 ${completed} / 6 个模块`;
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
    <main className="min-h-screen px-4 py-8 sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-5xl">
        <header>
          <div className="flex items-start gap-3">
            <span className="mt-1 grid size-9 place-items-center rounded-2xl bg-mist text-primary"><Compass size={19} aria-hidden="true" /></span>
            <div><p className="font-mono text-xs font-medium tracking-[0.16em] text-secondary">第二视角 · 分析工作台</p>
              <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">认知体检报告</h1></div>
          </div>
        </header>

        <div className="mt-8 overflow-hidden rounded-[1.75rem] border border-border bg-white/75 shadow-[0_20px_45px_-35px_rgba(22,58,54,0.35)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-mist/55 px-5 py-3 text-sm"><p className="flex items-center gap-2 font-semibold text-primary"><Radio size={15} aria-hidden="true" />{progressText}</p><p className="font-mono text-xs text-ink-faint">{connectionText}</p></div>
          <p className="px-5 py-5 leading-7 text-ink">
            {snapshot.materialPreview}
          </p>
        </div>

        <div className="mt-7 space-y-4 border-l border-border pl-4 sm:pl-6">
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
        </div>

        <div className="mt-7 grid gap-4 lg:grid-cols-2">
          <ConversationPanel
            jobId={snapshot.jobId}
            messages={snapshot.messages}
            selectedTarget={selectedTarget}
            onRefresh={refreshSnapshot}
          />
          <RevisionHistory
            revisions={snapshot.revisions}
            modules={snapshot.modules}
          />
        </div>

        <p className="mt-8 rounded-2xl bg-forest-soft px-5 py-4 text-sm leading-6 text-ink-faint">
          {disclaimer}
        </p>
      </div>
    </main>
  );
}
