"use client";

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
import { AgentRunStatus } from "./agent-run-status";
import { AgentProcessTimeline } from "./agent-process-timeline";
import { CurrentFindingsPanel, firstAvailableFindingTarget } from "./current-findings-panel";

const disclaimer =
  "本报告由 AI 生成，旨在提供多角度思考框架。请核对引用，并结合自身知识独立判断。";

export function AnalysisWorkspace({
  initialSnapshot,
}: {
  initialSnapshot: AnalysisSnapshot;
}) {
  const { snapshot, agentOutput, agentProcess, retryModule, applySnapshot, refreshSnapshot } =
    useAnalysisStream(initialSnapshot.workspaceId, initialSnapshot);
  const [selectedTarget, setSelectedTarget] = useState<ReportItemTarget>();
  const firstModuleEventWorkspaceId = useRef<string | null>(null);
  useEffect(() => {
    const moduleType = moduleTypes.find(
      (candidate) => snapshot.modules[candidate].status === "completed",
    );
    if (!moduleType || firstModuleEventWorkspaceId.current === snapshot.workspaceId) return;
    firstModuleEventWorkspaceId.current = snapshot.workspaceId;
    void fetch(
      "/api/product-events",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventName: "first_module_shown",
          jobId: snapshot.workspaceId,
          moduleType,
        }),
        keepalive: true,
      },
    ).catch(() => {});
  }, [snapshot.workspaceId, snapshot.modules]);
  useEffect(() => {
    if (selectedTarget) return;
    const target = firstAvailableFindingTarget(snapshot.modules);
    if (target) setSelectedTarget(target);
  }, [selectedTarget, snapshot.modules]);
  const overview = snapshot.modules.overview;
  const argument = snapshot.modules.argument;
  const perspectives = snapshot.modules.perspectives;
  const sources = snapshot.modules.sources;
  const risks = snapshot.modules.risks;
  const reflection = snapshot.modules.reflection;
  return (
    <main className="h-[calc(100dvh-4.5rem)] overflow-hidden">
      <AgentWorkspaceLayout
          conversation={<div className="flex h-full min-h-0 flex-col"><div className="ml-auto max-w-[92%] rounded-2xl rounded-tr-sm bg-primary px-4 py-3 text-sm leading-7 text-white"><p className="mb-1 text-xs font-semibold text-white/70">你</p>{snapshot.materialPreview}</div><div className="mt-6 min-h-0 flex-1"><AgentProcessTimeline process={agentProcess} /><AgentRunStatus workspaceId={snapshot.workspaceId} activeRun={snapshot.activeRun} toolCalls={snapshot.toolCalls} onSnapshot={applySnapshot} onRefresh={refreshSnapshot} /><ConversationPanel jobId={snapshot.workspaceId} messages={snapshot.messages} activeRun={snapshot.activeRun} selectedTarget={selectedTarget} agentOutput={agentOutput} onRefresh={refreshSnapshot} /></div></div>}
          findings={<><CurrentFindingsPanel modules={snapshot.modules} selectedTarget={selectedTarget} onSelect={setSelectedTarget} /><section className="mt-8" aria-label="完整报告"><div className="space-y-4">
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
          <RevisionHistory revisions={snapshot.revisions} modules={snapshot.modules} />
          <p className="rounded-xl bg-forest-soft px-4 py-3 text-xs leading-5 text-ink-faint">{disclaimer}</p></div></section></>}
      />
    </main>
  );
}
