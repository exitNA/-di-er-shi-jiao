"use client";

import { Activity, Bot, Brain, FileText, Search, ShieldAlert, UsersRound, Wrench } from "lucide-react";

import type { AgentProcessEntry, AgentProcessRun, AgentProcessState } from "@/features/analysis/hooks/use-analysis-stream";

export function AgentProcessTimeline({ process }: { process: AgentProcessState }) {
  const children = new Map<string, AgentProcessRun[]>();
  const roots: AgentProcessRun[] = [];
  for (const run of process.runs) {
    if (run.parentRunId && process.runs.some((candidate) => candidate.id === run.parentRunId)) {
      const siblings = children.get(run.parentRunId) ?? [];
      siblings.push(run);
      children.set(run.parentRunId, siblings);
    } else {
      roots.push(run);
    }
  }
  if (!roots.length) return null;

  return (
    <section className="mb-4 rounded-2xl border border-border bg-white" aria-label="Agent 过程">
      <details open>
        <summary className="flex cursor-pointer list-none items-center gap-2 p-4 marker:hidden">
          <Activity className="size-4 text-secondary" aria-hidden="true" />
          <span className="text-sm font-medium">Agent 过程</span>
          <span className="text-xs text-ink-faint">实时更新</span>
        </summary>
        <div className="max-h-72 space-y-3 overflow-y-auto border-t border-border px-4 py-3 overscroll-contain">
          {roots.map((run) => <Run key={run.id} run={run} runChildren={children} />)}
        </div>
      </details>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {latestAnnouncement(process)}
      </p>
    </section>
  );
}

function Run({ run, runChildren }: { run: AgentProcessRun; runChildren: ReadonlyMap<string, AgentProcessRun[]> }) {
  const nested = runChildren.get(run.id) ?? [];
  return (
    <details className="rounded-xl bg-forest-soft/55" open={run.status === "running"}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 marker:hidden">
        {agentIcon(run.name)}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{run.name}</span>
        <span className="text-xs text-ink-faint">{runStatusLabel(run.status)}</span>
      </summary>
      <div className="space-y-3 border-t border-border/70 px-3 py-3">
        {run.steps.map((step) => (
          <div key={step.id}>
            <p className="text-xs font-medium text-ink-faint">{step.name} · {stepStatusLabel(step.status)}</p>
            <ol className="mt-2 space-y-2">
              {step.entries.map((entry) => <Entry key={entry.id} entry={entry} />)}
            </ol>
          </div>
        ))}
        {nested.length ? (
          <div className="space-y-3 border-l border-border pl-3">
            {nested.map((child) => <Run key={child.id} run={child} runChildren={runChildren} />)}
          </div>
        ) : null}
      </div>
    </details>
  );
}

function Entry({ entry }: { entry: AgentProcessEntry }) {
  const label = entryLabel(entry.kind);
  return (
    <li className="flex gap-2 text-sm leading-6">
      {entryIcon(entry.kind)}
      <div className="min-w-0">
        <p className="font-medium">
          {label}
          {entry.title ? <span className="text-ink-faint"> · {entry.title}</span> : null}
        </p>
        {entry.content ? <p className="whitespace-pre-wrap text-ink-faint">{entry.content}</p> : null}
        {entry.status ? <p className="text-xs text-ink-faint">{entryStatusLabel(entry.status)}</p> : null}
      </div>
    </li>
  );
}

function agentIcon(name: string) {
  const className = "size-4 shrink-0 text-secondary";
  if (name.includes("信源") || name.includes("研究")) return <Search className={className} aria-hidden="true" />;
  if (name.includes("风险")) return <ShieldAlert className={className} aria-hidden="true" />;
  if (name.includes("客户") || name.includes("经理")) return <UsersRound className={className} aria-hidden="true" />;
  return <Bot className={className} aria-hidden="true" />;
}

function entryIcon(kind: AgentProcessEntry["kind"]) {
  const className = "mt-1 size-3.5 shrink-0 text-ink-faint";
  if (kind === "reasoning") return <Brain className={className} aria-hidden="true" />;
  if (kind === "tool") return <Wrench className={className} aria-hidden="true" />;
  if (kind === "text") return <FileText className={className} aria-hidden="true" />;
  return <Activity className={className} aria-hidden="true" />;
}

function entryLabel(kind: AgentProcessEntry["kind"]): string {
  if (kind === "reasoning") return "模型推理";
  if (kind === "tool") return "工具";
  if (kind === "text") return "输出";
  return "动态";
}

function latestAnnouncement(process: AgentProcessState): string {
  const run = process.runs.at(-1);
  const step = run?.steps.at(-1);
  const entry = step?.entries.at(-1);
  if (!run || !entry) return "";
  return `${run.name} ${entry.title ?? ""} ${entry.content ?? ""}`.trim();
}

function runStatusLabel(status: AgentProcessRun["status"]): string {
  return { running: "进行中", completed: "已完成", interrupted: "已中断", failed: "未完成" }[status];
}

function stepStatusLabel(status: "running" | "completed" | "failed"): string {
  return { running: "进行中", completed: "已完成", failed: "未完成" }[status];
}

function entryStatusLabel(status: "running" | "completed" | "failed"): string {
  return { running: "进行中", completed: "已完成", failed: "未完成" }[status];
}
