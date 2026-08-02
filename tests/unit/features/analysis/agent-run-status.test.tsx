import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { AgentRunStatus } from "@/features/analysis/components/agent-run-status";
import type { AnalysisSnapshot } from "@/features/analysis/domain/contracts";
import type {
  WorkspaceAgentRun,
  WorkspaceToolCall,
} from "@/features/analysis/domain/workspace";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("shows safe expert progress and lets the owner interrupt a running Agent", async () => {
  const onRefresh = vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined);
  const onSnapshot = vi.fn<(snapshot: AnalysisSnapshot) => void>();
  const nextSnapshot = snapshot("interrupted");
  const fetchMock = vi.fn().mockResolvedValue(Response.json(nextSnapshot));
  vi.stubGlobal("fetch", fetchMock);

  render(
    <AgentRunStatus
      workspaceId="workspace-1"
      activeRun={run("running")}
      toolCalls={[toolCall()]}
      onSnapshot={onSnapshot}
      onRefresh={onRefresh}
    />,
  );

  expect(screen.getByRole("region", { name: "Agent 工作状态" })).toBeVisible();
  expect(screen.getByText("正在核对核心主张。")).toBeVisible();
  expect(screen.queryByText("analyze_argument")).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "终止任务" }));

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/analyses/workspace-1/runs/22222222-2222-4222-8222-222222222222/cancel",
    expect.objectContaining({ method: "POST" }),
  );
  await waitFor(() => expect(onSnapshot).toHaveBeenCalledWith(nextSnapshot));
  expect(onRefresh).not.toHaveBeenCalled();
});

it("lets the owner continue an interrupted Agent run without moving focus", async () => {
  const onRefresh = vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined);
  const onSnapshot = vi.fn<(snapshot: AnalysisSnapshot) => void>();
  const fetchMock = vi.fn().mockResolvedValue(Response.json(snapshot("queued")));
  vi.stubGlobal("fetch", fetchMock);
  const { rerender } = render(
    <AgentRunStatus
      workspaceId="workspace-1"
      activeRun={run("interrupted")}
      toolCalls={[]}
      onSnapshot={onSnapshot}
      onRefresh={onRefresh}
    />,
  );
  const resume = screen.getByRole("button", { name: "继续分析" });
  resume.focus();

  rerender(
    <AgentRunStatus
      workspaceId="workspace-1"
      activeRun={run("interrupted")}
      toolCalls={[]}
      onSnapshot={onSnapshot}
      onRefresh={onRefresh}
    />,
  );
  expect(resume).toHaveFocus();

  await userEvent.click(resume);

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/analyses/workspace-1/runs/22222222-2222-4222-8222-222222222222/resume",
    expect.objectContaining({ method: "POST" }),
  );
  await waitFor(() => expect(onSnapshot).toHaveBeenCalledOnce());
  expect(onRefresh).not.toHaveBeenCalled();
});

it("lets the owner cancel a queued Agent run", () => {
  render(
    <AgentRunStatus
      workspaceId="workspace-1"
      activeRun={run("queued")}
      toolCalls={[]}
      onSnapshot={vi.fn<(snapshot: AnalysisSnapshot) => void>()}
      onRefresh={vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined)}
    />,
  );

  expect(screen.getByRole("button", { name: "终止任务" })).toBeEnabled();
});

it("keeps operation success distinct when its returned snapshot cannot be applied", async () => {
  const onRefresh = vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined);
  const onSnapshot = vi.fn<(snapshot: AnalysisSnapshot) => void>();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json")));

  render(
    <AgentRunStatus
      workspaceId="workspace-1"
      activeRun={run("running")}
      toolCalls={[]}
      onSnapshot={onSnapshot}
      onRefresh={onRefresh}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: "终止任务" }));

  expect(screen.getByText("任务操作已完成，但状态尚未刷新。")).toBeVisible();
  expect(screen.getByRole("button", { name: "刷新状态" })).toBeVisible();
  expect(onSnapshot).not.toHaveBeenCalled();
});

it("limits live announcements to the changing status and newest safe summary", () => {
  const onRefresh = vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined);
  const { container } = render(
    <AgentRunStatus
      workspaceId="workspace-1"
      activeRun={run("running")}
      toolCalls={[toolCall()]}
      onSnapshot={vi.fn<(snapshot: AnalysisSnapshot) => void>()}
      onRefresh={onRefresh}
    />,
  );

  const liveRegion = container.querySelector("[aria-live]");
  if (!liveRegion) throw new Error("Expected a live status region");
  expect(liveRegion).toHaveAttribute("aria-live", "polite");
  expect(liveRegion).toHaveAttribute("aria-atomic", "true");
  expect(screen.getByRole("region", { name: "Agent 工作状态" })).not.toHaveAttribute("aria-live");
});

function run(status: WorkspaceAgentRun["status"]): WorkspaceAgentRun {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    workspaceId: "workspace-1",
    kind: "baseline",
    status,
    configVersion: "agent-v1",
    cancellationRequestedAt: status === "interrupted" ? "2026-08-02T00:00:00.000Z" : null,
    startedAt: "2026-08-02T00:00:00.000Z",
    completedAt: null,
  };
}

function toolCall(): WorkspaceToolCall {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    agentRunId: "22222222-2222-4222-8222-222222222222",
    toolName: "analyze_argument",
    status: "running",
    summary: "正在核对核心主张。",
    errorCode: null,
    createdAt: "2026-08-02T00:00:00.000Z",
    completedAt: null,
  };
}

function snapshot(status: WorkspaceAgentRun["status"]): AnalysisSnapshot {
  return {
    workspaceId: "workspace-1",
    reportId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    currentVersion: 0,
    status,
    configVersion: "baseline-v1",
    materialPreview: "材料",
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    lastEventId: 1,
    activeRun: run(status),
    toolCalls: [],
    messages: [],
    revisions: [],
    modules: {
      overview: { status: "queued", version: 0 },
      argument: { status: "queued", version: 0 },
      perspectives: { status: "queued", version: 0 },
      sources: { status: "queued", version: 0 },
      risks: { status: "queued", version: 0 },
      reflection: { status: "queued", version: 0 },
    },
  };
}
