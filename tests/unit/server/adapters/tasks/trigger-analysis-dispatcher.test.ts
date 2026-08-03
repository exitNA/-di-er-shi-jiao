import { beforeEach, describe, expect, it, vi } from "vitest";
import { InProcessAnalysisDispatcher } from "@/server/adapters/tasks/in-process-analysis-dispatcher";
import { TriggerAnalysisDispatcher } from "@/server/adapters/tasks/trigger-analysis-dispatcher";

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  flushLangfuseTracing: vi.fn(),
  getContainer: vi.fn(),
  startLangfuseTracing: vi.fn(),
  trigger: vi.fn(),
}));

vi.mock("@trigger.dev/sdk", () => ({
  runs: { cancel: mocks.cancel },
  task: (definition: unknown) => definition,
  tasks: { trigger: mocks.trigger },
}));
vi.mock("@/server/container", () => ({
  getContainer: mocks.getContainer,
}));
vi.mock("@/server/observability/tracing", () => ({
  flushLangfuseTracing: mocks.flushLangfuseTracing,
  startLangfuseTracing: mocks.startLangfuseTracing,
}));

import { runAgentTask } from "@/trigger/run-agent";

describe("TriggerAnalysisDispatcher", () => {
  beforeEach(() => {
    mocks.trigger.mockResolvedValue({ id: "run-1" });
  });

  it("binds the Trigger task to one workspace Agent run", async () => {
    const result = await new TriggerAnalysisDispatcher().enqueue({
      workspaceId: "workspace-1",
      agentRunId: "agent-run-1",
      dispatchKey: "workspace-1:agent-run-1",
    });

    expect(mocks.trigger).toHaveBeenCalledWith(
      "run-agent",
      { workspaceId: "workspace-1", agentRunId: "agent-run-1" },
      { idempotencyKey: "workspace-1:agent-run-1" },
    );
    expect(result).toEqual({ runId: "run-1" });
  });

  it("cancels the bound Trigger run", async () => {
    await new TriggerAnalysisDispatcher().cancel("run-1");

    expect(mocks.cancel).toHaveBeenCalledWith("run-1");
  });
});

describe("runAgentTask", () => {
  beforeEach(() => {
    mocks.startLangfuseTracing.mockResolvedValue(undefined);
    mocks.flushLangfuseTracing.mockResolvedValue(undefined);
  });

  it("passes Trigger cancellation into the Agent runtime", async () => {
    const signal = new AbortController().signal;
    const repository = {
      getJobForExecution: vi.fn().mockResolvedValue({ userId: "owner-1" }),
      claimAgentRun: vi.fn().mockResolvedValue(true),
      requestAgentRunCancellation: vi.fn(),
      finishAgentRun: vi.fn().mockResolvedValue(true),
    };
    const runtime = { run: vi.fn().mockResolvedValue({ status: "completed" }) };
    mocks.getContainer.mockReturnValue({
      analysisRepository: repository,
      workspaceAgentRuntime: runtime,
    });

    await runAgentTask.run(
      { workspaceId: "workspace-1", agentRunId: "agent-run-1" },
      { ctx: { run: { id: "trigger-run-1" } }, signal } as never,
    );

    expect(repository.claimAgentRun).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-1",
      agentRunId: "agent-run-1",
      triggerRunId: "trigger-run-1",
    }));
    expect(runtime.run).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      agentRunId: "agent-run-1",
      signal,
    });
    expect(repository.finishAgentRun).toHaveBeenCalledWith(expect.objectContaining({
      status: "completed",
    }));
  });

  it("isolates and flushes Langfuse before constructing the Trigger runtime", async () => {
    const calls: string[] = [];
    mocks.startLangfuseTracing.mockImplementation(async () => { calls.push("tracing"); });
    mocks.getContainer.mockImplementation(() => {
      calls.push("container");
      return {
        analysisRepository: {
          getJobForExecution: vi.fn().mockResolvedValue(undefined),
        },
        workspaceAgentRuntime: { run: vi.fn() },
      };
    });

    await runAgentTask.run(
      { workspaceId: "workspace-1", agentRunId: "agent-run-1" },
      {
        ctx: { run: { id: "trigger-run-1" } },
        signal: new AbortController().signal,
      } as never,
    );

    expect(calls).toEqual(["tracing", "container"]);
    expect(mocks.startLangfuseTracing).toHaveBeenCalledWith({ isolated: true });
    expect(mocks.flushLangfuseTracing).toHaveBeenCalledOnce();
  });
});

describe("InProcessAnalysisDispatcher", () => {
  it("runs and cancels the selected Agent run in the current process", async () => {
    const pending = Promise.withResolvers<{ status: "interrupted" }>();
    const calls: string[] = [];
    const runtime = {
      run: vi.fn()
        .mockImplementationOnce(async () => {
          calls.push("first-started");
          const result = await pending.promise;
          calls.push("first-settled");
          return result;
        })
        .mockImplementationOnce(async () => {
          calls.push("second-started");
          return { status: "completed" as const };
        }),
    };
    const repository = {
      getJobForExecution: vi.fn().mockResolvedValue({ userId: "owner-1" }),
      claimAgentRun: vi.fn().mockResolvedValue(true),
      requestAgentRunCancellation: vi.fn().mockResolvedValue({ eventId: 1, triggerRunId: null }),
      finishAgentRun: vi.fn(),
    };
    const dispatcher = new InProcessAnalysisDispatcher(runtime, repository);

    const result = await dispatcher.enqueue({
      workspaceId: "workspace-1",
      agentRunId: "agent-run-1",
      dispatchKey: "unused-in-process",
    });
    await vi.waitFor(() => expect(runtime.run).toHaveBeenCalledOnce());
    let cancellationSettled = false;
    const cancellation = dispatcher.cancel(result.runId).then(() => {
      cancellationSettled = true;
    });
    await Promise.resolve();
    expect(cancellationSettled).toBe(false);
    pending.resolve({ status: "interrupted" });
    await cancellation;

    await dispatcher.enqueue({
      workspaceId: "workspace-1",
      agentRunId: "agent-run-2",
      dispatchKey: "unused-in-process",
    });
    await vi.waitFor(() => expect(runtime.run).toHaveBeenCalledTimes(2));

    expect(runtime.run).toHaveBeenNthCalledWith(1, expect.objectContaining({
      workspaceId: "workspace-1",
      agentRunId: "agent-run-1",
      signal: expect.objectContaining({ aborted: true }),
    }));
    expect(calls).toEqual(["first-started", "first-settled", "second-started"]);
    expect(result).toEqual({ runId: "in-process:agent-run-1" });
  });
});
