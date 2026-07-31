import { beforeEach, describe, expect, it, vi } from "vitest";
import { InProcessAnalysisDispatcher } from "@/server/adapters/tasks/in-process-analysis-dispatcher";
import { TriggerAnalysisDispatcher } from "@/server/adapters/tasks/trigger-analysis-dispatcher";

const { trigger } = vi.hoisted(() => ({
  trigger: vi.fn(),
}));

vi.mock("@trigger.dev/sdk", () => ({
  tasks: { trigger },
}));

describe("TriggerAnalysisDispatcher", () => {
  beforeEach(() => {
    trigger.mockResolvedValue({ id: "run-1" });
  });

  it("uses the dispatch key as Trigger idempotency key", async () => {
    const result = await new TriggerAnalysisDispatcher().enqueue({
      jobId: "job-1",
      moduleType: "sources",
      dispatchKey: "job-1:sources:2",
    });

    expect(trigger).toHaveBeenCalledWith(
      "run-baseline-analysis",
      { jobId: "job-1", moduleType: "sources" },
      { idempotencyKey: "job-1:sources:2" },
    );
    expect(result).toEqual({ runId: "run-1" });
  });
});

describe("InProcessAnalysisDispatcher", () => {
  it("schedules the selected module in the current process", async () => {
    const run = vi.fn().mockResolvedValue({ status: "completed" });
    const dispatcher = new InProcessAnalysisDispatcher({ run });

    const result = await dispatcher.enqueue({
      jobId: "job-1",
      moduleType: "sources",
      dispatchKey: "unused-in-process",
    });
    await Promise.resolve();

    expect(run).toHaveBeenCalledWith({
      jobId: "job-1",
      onlyModule: "sources",
    });
    expect(result).toEqual({ runId: "in-process:job-1:sources" });
  });
});
