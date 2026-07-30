import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AnalysisSnapshot,
  ReportModuleType,
} from "@/features/analysis/domain/contracts";
import { BaselineOrchestrator } from "@/server/agents/baseline-orchestrator";

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
    getOwnedSnapshot: vi.fn(),
    listEvents: vi.fn(),
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
    dispatcher.enqueue.mockResolvedValue({ runId: "run-1" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 404 rather than revealing another user's job", async () => {
    repository.getOwnedSnapshot.mockResolvedValue(null);

    const response = await getSnapshot(
      new Request("http://localhost/api/analyses/not-owned"),
      context({ jobId: "not-owned" }),
    );

    expect(response.status).toBe(404);
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
    abort.abort();
    await vi.advanceTimersByTimeAsync(100);

    expect(new TextDecoder().decode(first.value)).toContain("id: 3");
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
      repository.getOwnedSnapshot.mockResolvedValue(current);

      const response = await retryModule(
        retryRequest(moduleType),
        retryContext(moduleType),
      );

      expect(response.status).toBe(202);
      expect(dispatcher.enqueue).toHaveBeenCalledWith({
        jobId: "job-1",
        moduleType,
        dispatchKey: `job-1:${moduleType}:3`,
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

  it("lets a module worker consume a retry lock acquired by the route", async () => {
    const marker = new Error("past acquisition");
    const orchestratorRepository = {
      getJobForExecution: vi.fn().mockResolvedValue({
        jobId: "job-1",
        userId: "owner-1",
        reportId: "report-1",
        material: "材料",
        detectedLanguage: "zh",
        status: "running",
        configVersion: "baseline-v1",
      }),
      getOwnedSnapshot: vi.fn().mockResolvedValue(snapshot({
        status: "running",
        modules: {
          ...emptyModules(),
          sources: { status: "failed", version: 1 },
        },
      })),
      transitionJob: vi.fn(),
      appendEvent: vi.fn().mockRejectedValue(marker),
    };
    const orchestrator = new BaselineOrchestrator(
      {} as never,
      orchestratorRepository as never,
    );

    await expect(
      orchestrator.run({ jobId: "job-1", onlyModule: "sources" }),
    ).rejects.toBe(marker);
    expect(orchestratorRepository.transitionJob).not.toHaveBeenCalled();
  });
});

function retryRequest(moduleType: string) {
  return new Request(
    `http://localhost/api/analyses/job-1/modules/${moduleType}/retry`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );
}

function retryContext(moduleType: string) {
  return context({ jobId: "job-1", moduleType });
}

function context<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}

function snapshot(
  overrides: Partial<AnalysisSnapshot> = {},
): AnalysisSnapshot {
  return {
    jobId: "job-1",
    status: "running",
    configVersion: "baseline-v1",
    materialPreview: "材料",
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
    lastEventId: 0,
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
