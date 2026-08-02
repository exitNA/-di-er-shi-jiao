import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisSnapshot } from "@/features/analysis/domain/contracts";

const mocks = vi.hoisted(() => ({
  assertTrustedMutation: vi.fn(),
  getContainer: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock("@/features/auth/server/current-user", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock("@/features/auth/server/http", () => ({
  assertTrustedMutation: mocks.assertTrustedMutation,
}));
vi.mock("@/server/container", () => ({
  getContainer: mocks.getContainer,
}));

import { POST as cancelRun } from "@/app/api/analyses/[jobId]/runs/[runId]/cancel/route";
import { POST as resumeRun } from "@/app/api/analyses/[jobId]/runs/[runId]/resume/route";

describe("Agent run mutation routes", () => {
  const repository = {
    claimAgentRun: vi.fn(),
    createAgentRun: vi.fn(),
    finishAgentRun: vi.fn(),
    getOwnedSnapshot: vi.fn(),
    requestAgentRunCancellation: vi.fn(),
  };
  const dispatcher = { cancel: vi.fn(), enqueue: vi.fn() };

  beforeEach(() => {
    mocks.assertTrustedMutation.mockReturnValue(null);
    mocks.getCurrentUser.mockResolvedValue({ id: "owner-1", username: "owner" });
    mocks.getContainer.mockReturnValue({
      analysisDispatcher: dispatcher,
      analysisRepository: repository,
    });
    repository.createAgentRun.mockResolvedValue({ id: "agent-run-2" });
    repository.requestAgentRunCancellation.mockResolvedValue({
      eventId: 1,
      triggerRunId: "trigger-run-1",
    });
    dispatcher.enqueue.mockResolvedValue({ runId: "trigger-run-2" });
  });

  it("cancels only the owner's latest active Agent run", async () => {
    repository.getOwnedSnapshot
      .mockResolvedValueOnce(snapshot("running"))
      .mockResolvedValueOnce(snapshot("interrupted"));

    const response = await cancelRun(request("cancel"), context("agent-run-1"));
    const body = await response.json() as AnalysisSnapshot;

    expect(response.status).toBe(200);
    expect(body.activeRun?.status).toBe("interrupted");
    expect(repository.requestAgentRunCancellation).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-1",
      userId: "owner-1",
      agentRunId: "agent-run-1",
    }));
    expect(dispatcher.cancel).toHaveBeenCalledWith("trigger-run-1");
  });

  it("returns 404 without revealing another user's Agent run", async () => {
    repository.getOwnedSnapshot.mockResolvedValue(null);

    const response = await cancelRun(request("cancel"), context("agent-run-1"));

    expect(response.status).toBe(404);
    expect(repository.requestAgentRunCancellation).not.toHaveBeenCalled();
  });

  it("rejects an untrusted mutation before reading the current user", async () => {
    mocks.assertTrustedMutation.mockReturnValue(
      Response.json({ error: "forbidden" }, { status: 403 }),
    );

    const response = await resumeRun(request("resume"), context("agent-run-1"));

    expect(response.status).toBe(403);
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
  });

  it("resumes only the latest interrupted run in the same workspace context", async () => {
    repository.getOwnedSnapshot
      .mockResolvedValueOnce(snapshot("interrupted"))
      .mockResolvedValueOnce(snapshot("queued", "agent-run-2"));

    const response = await resumeRun(request("resume"), context("agent-run-1"));
    const body = await response.json() as AnalysisSnapshot;

    expect(response.status).toBe(200);
    expect(body.activeRun?.id).toBe("agent-run-2");
    expect(repository.createAgentRun).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-1",
      userId: "owner-1",
      kind: "baseline",
      configVersion: "agent-v1",
      previousAgentRunId: "agent-run-1",
    }));
    expect(dispatcher.enqueue).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      agentRunId: "agent-run-2",
      dispatchKey: "workspace-1:agent-run-2",
    });
  });

  it("rejects a stale run id without creating another run", async () => {
    repository.getOwnedSnapshot.mockResolvedValue(snapshot("interrupted", "agent-run-2"));

    const response = await resumeRun(request("resume"), context("agent-run-1"));

    expect(response.status).toBe(404);
    expect(repository.createAgentRun).not.toHaveBeenCalled();
  });
});

function request(action: "cancel" | "resume") {
  return new Request(
    `http://localhost/api/analyses/workspace-1/runs/agent-run-1/${action}`,
    { method: "POST" },
  );
}

function context(runId: string) {
  return { params: Promise.resolve({ jobId: "workspace-1", runId }) };
}

function snapshot(
  status: NonNullable<AnalysisSnapshot["activeRun"]>["status"],
  runId = "agent-run-1",
): AnalysisSnapshot {
  return {
    workspaceId: "workspace-1",
    reportId: "report-1",
    currentVersion: 0,
    status,
    configVersion: "baseline-v1",
    materialPreview: "材料",
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    lastEventId: 0,
    activeRun: {
      id: runId,
      workspaceId: "workspace-1",
      kind: "baseline",
      status,
      configVersion: "agent-v1",
      cancellationRequestedAt: status === "interrupted" ? "2026-08-02T00:00:00.000Z" : null,
      startedAt: null,
      completedAt: null,
    },
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
