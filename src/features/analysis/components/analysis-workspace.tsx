"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

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
} from "@/features/analysis/domain/contracts";
import { useAnalysisStream } from "@/features/analysis/hooks/use-analysis-stream";

const disclaimer =
  "本报告由 AI 生成，旨在提供多角度思考框架。请核对引用，并结合自身知识独立判断。";

export function AnalysisWorkspace({
  initialSnapshot,
}: {
  initialSnapshot: AnalysisSnapshot;
}) {
  const { snapshot, connectionState, retryModule } = useAnalysisStream(
    initialSnapshot.jobId,
    initialSnapshot,
  );
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
    <main className="min-h-screen px-6 py-12">
      <div className="mx-auto w-full max-w-4xl">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium tracking-[0.2em] text-neutral-500">
              第二视角
            </p>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight">
              认知体检报告
            </h1>
          </div>
          <nav className="flex gap-4" aria-label="报告导航">
            <Link className="underline" href="/">
              返回输入页
            </Link>
            <Link className="underline" href="/history">
              历史记录
            </Link>
          </nav>
        </header>

        <div className="mt-8 rounded-lg border border-neutral-300 bg-white p-5">
          <p aria-live="polite" aria-atomic="true" className="font-medium">
            {progressText}
          </p>
          <p className="mt-1 text-sm text-neutral-600">{connectionText}</p>
          <p className="mt-4 leading-7 text-neutral-700">
            {snapshot.materialPreview}
          </p>
        </div>

        <div className="mt-6 space-y-6">
          <ReportModule
            id="report-module-overview"
            moduleType="overview"
            title="速览"
            status={overview.status}
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
          >
            {reflection.payload ? (
              <ReflectionModule
                data={reflection.payload as ReflectionModuleData}
              />
            ) : undefined}
          </ReportModule>
        </div>

        <p className="mt-8 rounded-lg bg-neutral-100 p-4 text-sm leading-6 text-neutral-700">
          {disclaimer}
        </p>
      </div>
    </main>
  );
}
