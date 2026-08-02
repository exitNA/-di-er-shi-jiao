import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AnalysisSnapshot,
  ReportModuleType,
} from "@/features/analysis/domain/contracts";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getContainer: vi.fn(),
  assertTrustedMutation: vi.fn(),
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

import { GET as getSnapshot } from "@/app/api/analyses/[jobId]/route";
import { GET as getEvents } from "@/app/api/analyses/[jobId]/events/route";
import { POST as retryModule } from "@/app/api/analyses/[jobId]/modules/[moduleType]/retry/route";

describe("analysis access routes", () => {
  const repository = {
    claimAgentRun: vi.fn(),
    createAgentRun: vi.fn(),
    finishAgentRun: vi.fn(),
    getOwnedSnapshot: vi.fn(),
    listEvents: vi.fn(),
    requestAgentRunCancellation: vi.fn(),
    transitionJob: vi.fn(),
  };
  const dispatcher = { enqueue: vi.fn() };

  beforeEach(() => {
    mocks.getCurrentUser.mockResolvedValue({
      id: "owner-1",
      username: "owner",
    });
    mocks.assertTrustedMutation.mockReturnValue(null);
    mocks.getContainer.mockReturnValue({
      analysisRepository: repository,
      analysisDispatcher: dispatcher,
    });
    repository.getOwnedSnapshot.mockResolvedValue(snapshot());
    repository.listEvents.mockResolvedValue([]);
    repository.transitionJob.mockResolvedValue(true);
    repository.createAgentRun.mockResolvedValue({ id: "agent-run-2" });
    dispatcher.enqueue.mockResolvedValue({ runId: "run-1" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 404 for another user's snapshot, events, and retry", async () => {
    repository.getOwnedSnapshot.mockResolvedValue(null);

    const [snapshotResponse, eventsResponse, retryResponse] = await Promise.all([
      getSnapshot(
        new Request("http://localhost/api/analyses/not-owned"),
        context({ jobId: "not-owned" }),
      ),
      getEvents(
        new Request("http://localhost/api/analyses/not-owned/events"),
        context({ jobId: "not-owned" }),
      ),
      retryModule(
        retryRequest("sources", "not-owned"),
        retryContext("sources", "not-owned"),
      ),
    ]);

    expect([snapshotResponse.status, eventsResponse.status, retryResponse.status])
      .toEqual([404, 404, 404]);
    expect(repository.getOwnedSnapshot).toHaveBeenCalledWith(
      "owner-1",
      "not-owned",
    );
  });

  it("returns a snapshot with six module states for the owner", async () => {
    const response = await getSnapshot(
      new Request("http://localhost/api/analyses/job-1"),
      context({ jobId: "job-1" }),
    );
    const body = await response.json() as AnalysisSnapshot;

    expect(response.status).toBe(200);
    expect(Object.keys(body.modules)).toHaveLength(6);
  });

  it("emits only events after the requested cursor", async () => {
    vi.useFakeTimers();
    repository.listEvents.mockResolvedValueOnce([
      {
        id: 3,
        jobId: "job-1",
        userId: "owner-1",
        eventType: "module.updated",
        payload: {},
        createdAt: "2026-07-30T00:00:00.000Z",
      },
    ]);
    const abort = new AbortController();
    const response = await getEvents(
      new Request("http://localhost/api/analyses/job-1/events?after=2", {
        signal: abort.signal,
      }),
      context({ jobId: "job-1" }),
    );
    const reader = response.body!.getReader();
    const first = await reader.read();
    const second = await reader.read();
    const third = await reader.read();
    abort.abort();
    await vi.advanceTimersByTimeAsync(100);

    const decoder = new TextDecoder();
    expect(decoder.decode(first.value)).toContain('"type":"STATE_SNAPSHOT"');
    expect(decoder.decode(second.value)).toContain('"type":"MESSAGES_SNAPSHOT"');
    expect(decoder.decode(third.value)).toContain("id: 3");
    expect(decoder.decode(third.value)).toContain('"type":"CUSTOM"');
    expect(repository.listEvents).toHaveBeenCalledWith(
      "owner-1",
      "job-1",
      2,
      100,
    );
  });

  it("rejects retry unless the selected module is failed", async () => {
    repository.getOwnedSnapshot.mockResolvedValue(snapshot({
      status: "recoverable",
    }));

    const response = await retryModule(
      retryRequest("sources"),
      retryContext("sources"),
    );

    expect(response.status).toBe(409);
    expect(dispatcher.enqueue).not.toHaveBeenCalled();
  });

  it.each(["sources", "argument", "perspectives", "risks"] as const)(
    "allows retry for %s",
    async (moduleType) => {
      const current = snapshot({ status: "recoverable" });
      current.modules[moduleType] = {
        status: "failed",
        version: 2,
        errorCode: "EXPERT_FAILED",
      };
      current.activeRun = agentRun("recoverable");
      repository.getOwnedSnapshot.mockResolvedValue(current);

      const response = await retryModule(
        retryRequest(moduleType),
        retryContext(moduleType),
      );

      expect(response.status).toBe(202);
      expect(dispatcher.enqueue).toHaveBeenCalledWith({
        workspaceId: "job-1",
        agentRunId: "agent-run-2",
        dispatchKey: "job-1:agent-run-2",
      });
    },
  );

  it.each(["overview", "reflection"])(
    "rejects retry for %s",
    async (moduleType) => {
      const response = await retryModule(
        retryRequest(moduleType),
        retryContext(moduleType),
      );

      expect(response.status).toBe(400);
      expect(dispatcher.enqueue).not.toHaveBeenCalled();
    },
  );

});

function retryRequest(moduleType: string, jobId = "job-1") {
  return new Request(
    `http://localhost/api/analyses/${jobId}/modules/${moduleType}/retry`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );
}

function agentRun(status: "interrupted" | "recoverable"): NonNullable<AnalysisSnapshot["activeRun"]> {
  return {
    id: "agent-run-1",
    workspaceId: "job-1",
    kind: "baseline",
    status,
    configVersion: "agent-v1",
    cancellationRequestedAt: null,
    startedAt: "2026-07-30T00:00:00.000Z",
    completedAt: "2026-07-30T00:01:00.000Z",
  };
}

function retryContext(moduleType: string, jobId = "job-1") {
  return context({ jobId, moduleType });
}

function context<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}

function snapshot(
  overrides: Partial<AnalysisSnapshot> = {},
): AnalysisSnapshot {
  return {
    workspaceId: "job-1",
    reportId: "report-1",
    currentVersion: 0,
    status: "running",
    configVersion: "baseline-v1",
    materialPreview: "材料",
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
    lastEventId: 0,
    activeRun: null,
    toolCalls: [],
    messages: [],
    revisions: [],
    modules: emptyModules(),
    ...overrides,
  };
}

function emptyModules(): AnalysisSnapshot["modules"] {
  return Object.fromEntries(
    (
      [
        "overview",
        "argument",
        "perspectives",
        "sources",
        "risks",
        "reflection",
      ] satisfies ReportModuleType[]
    ).map((moduleType) => [
      moduleType,
      { status: "queued" as const, version: 0 },
    ]),
  ) as AnalysisSnapshot["modules"];
}
