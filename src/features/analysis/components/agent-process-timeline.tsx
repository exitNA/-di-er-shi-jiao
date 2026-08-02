"use client";

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
    <section className="mb-4 rounded-2xl border border-border bg-white p-4" aria-label="Agent 过程">
      <p className="text-sm font-medium">Agent 过程</p>
      <p className="mt-1 text-xs text-ink-faint">展示任务、模型输出、推理与工具调用。</p>
      <div className="mt-3 space-y-3">
        {roots.map((run) => <Run key={run.id} run={run} children={children} />)}
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {latestAnnouncement(process)}
      </p>
    </section>
  );
}

function Run({ run, children }: { run: AgentProcessRun; children: ReadonlyMap<string, AgentProcessRun[]> }) {
  const nested = children.get(run.id) ?? [];
  return (
    <details className="rounded-xl bg-forest-soft/55 px-3 py-2">
      <summary className="cursor-pointer list-none text-sm font-medium marker:hidden">
        <span>{run.name}</span>
        <span className="ml-2 text-xs font-normal text-ink-faint">{runStatusLabel(run.status)}</span>
      </summary>
      <div className="mt-3 border-l border-border pl-3">
        {run.steps.map((step) => (
          <div key={step.id} className="mb-3 last:mb-0">
            <p className="text-xs font-medium text-ink-faint">{step.name} · {stepStatusLabel(step.status)}</p>
            <ol className="mt-1 space-y-2">
              {step.entries.map((entry) => <Entry key={entry.id} entry={entry} />)}
            </ol>
          </div>
        ))}
        {nested.length ? (
          <div className="mt-3 space-y-3">
            {nested.map((child) => <Run key={child.id} run={child} children={children} />)}
          </div>
        ) : null}
      </div>
    </details>
  );
}

function Entry({ entry }: { entry: AgentProcessEntry }) {
  const label = entry.kind === "reasoning" ? "模型推理" : entry.kind === "tool" ? "工具" : entry.kind === "text" ? "输出" : "动态";
  return (
    <li className="text-sm leading-6">
      <span className="font-medium">{label}</span>
      {entry.title ? <span className="text-ink-faint"> · {entry.title}</span> : null}
      {entry.content ? <p className="mt-0.5 whitespace-pre-wrap text-ink-faint">{entry.content}</p> : null}
      {entry.status ? <span className="text-xs text-ink-faint">{entryStatusLabel(entry.status)}</span> : null}
    </li>
  );
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
