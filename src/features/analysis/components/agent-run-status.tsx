"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { AnalysisSnapshot } from "@/features/analysis/domain/contracts";
import type {
  WorkspaceAgentRun,
  WorkspaceToolCall,
} from "@/features/analysis/domain/workspace";

type ActionState =
  | "idle"
  | "cancelling"
  | "resuming"
  | "mutationFailed"
  | "refreshFailed"
  | "refreshing";

export function AgentRunStatus({
  workspaceId,
  activeRun,
  toolCalls,
  onSnapshot,
  onRefresh,
}: {
  workspaceId: string;
  activeRun: WorkspaceAgentRun | null;
  toolCalls: readonly WorkspaceToolCall[];
  onSnapshot: (snapshot: AnalysisSnapshot) => void;
  onRefresh: () => Promise<unknown>;
}) {
  const [actionState, setActionState] = useState<ActionState>("idle");
  if (!activeRun) return null;

  const activeRunId = activeRun.id;
  const summaries = toolCalls.filter((call) => call.agentRunId === activeRun.id);
  const newestSummary = summaries.at(-1)?.summary;
  const isCancellable = activeRun.status === "queued" || activeRun.status === "running";
  const isResumable =
    activeRun.status === "interrupted" || activeRun.status === "recoverable";
  const controlsDisabled =
    actionState === "cancelling"
    || actionState === "resuming"
    || actionState === "refreshing"
    || actionState === "refreshFailed";

  async function changeRun(action: "cancel" | "resume") {
    setActionState(action === "cancel" ? "cancelling" : "resuming");
    let response: Response;
    try {
      response = await fetch(
        `/api/analyses/${workspaceId}/runs/${activeRunId}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
    } catch {
      setActionState("mutationFailed");
      return;
    }
    if (!response.ok) {
      if (action === "cancel" && (response.status === 404 || response.status === 409)) {
        await refresh();
        return;
      }
      setActionState("mutationFailed");
      return;
    }
    try {
      onSnapshot(await response.json() as AnalysisSnapshot);
      setActionState("idle");
    } catch {
      setActionState("refreshFailed");
    }
  }

  async function refresh() {
    setActionState("refreshing");
    try {
      await onRefresh();
      setActionState("idle");
    } catch {
      setActionState("refreshFailed");
    }
  }

  return (
    <section
      aria-label="Agent 工作状态"
      className="mb-4 rounded-2xl border border-border bg-forest-soft/55 p-4"
    >
      <p className="text-sm font-medium">{statusLabel(activeRun, actionState)}</p>
      {newestSummary ? (
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {`${statusLabel(activeRun, actionState)} ${newestSummary}`}
        </p>
      ) : null}
      {summaries.length ? (
        <ol className="mt-3 space-y-2 text-sm leading-6 text-ink-faint">
          {summaries.map((call) => <li key={call.id}>{call.summary}</li>)}
        </ol>
      ) : null}
      {isCancellable ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-4"
          disabled={controlsDisabled}
          onClick={() => void changeRun("cancel")}
        >
          终止任务
        </Button>
      ) : null}
      {isResumable ? (
        <Button
          type="button"
          size="sm"
          className="mt-4"
          disabled={controlsDisabled}
          onClick={() => void changeRun("resume")}
        >
          继续分析
        </Button>
      ) : null}
      {actionState === "refreshFailed" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => void refresh()}
        >
          刷新状态
        </Button>
      ) : null}
    </section>
  );
}

function statusLabel(run: WorkspaceAgentRun, actionState: ActionState): string {
  if (actionState === "cancelling") return "正在终止任务…";
  if (actionState === "resuming") return "正在继续分析…";
  if (actionState === "refreshing") return "正在刷新任务状态…";
  if (actionState === "mutationFailed") return "操作未完成，请重试。";
  if (actionState === "refreshFailed") return "任务操作已完成，但状态尚未刷新。";
  return {
    queued: "正在等待 Agent 开始。",
    running: "Agent 正在分析。",
    interrupted: "任务已终止。",
    recoverable: "任务可继续分析。",
    completed: "任务已完成。",
  }[run.status];
}
