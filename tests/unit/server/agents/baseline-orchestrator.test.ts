import { describe, expect, it, vi } from "vitest";
import type { AnalysisSnapshot } from "@/features/analysis/domain/contracts";
import type { AnalysisRepository, ExecutionJob, SaveModule, StartExpertRun } from "@/features/analysis/server/analysis-repository";
import { BaselineOrchestrator } from "@/server/agents/baseline-orchestrator";
import { FakeExpertSuite } from "@/server/agents/fake-expert-suite";

const material = "素材中的第一句。第二句。";

class MemoryRepository {
  readonly job: ExecutionJob = {
    jobId: "job-1", userId: "user-1", reportId: "report-1", material, detectedLanguage: "zh", status: "queued", configVersion: "v1",
  };
  readonly modules = Object.fromEntries(
    ["overview", "argument", "perspectives", "sources", "risks", "reflection"].map((moduleType) => [moduleType, { status: "queued", version: 0 }]),
  ) as AnalysisSnapshot["modules"];
  status: AnalysisSnapshot["status"] = "queued";
  readonly runs: StartExpertRun[] = [];
  readonly saves: SaveModule[] = [];
  readonly events: string[] = [];

  async getJobForExecution() { return { ...this.job, status: this.status }; }
  async getOwnedSnapshot() {
    return { jobId: this.job.jobId, status: this.status, configVersion: "v1", materialPreview: material, createdAt: "", updatedAt: "", lastEventId: 0, modules: structuredClone(this.modules) };
  }
  async transitionJob(_jobId: string, from: AnalysisSnapshot["status"][], to: AnalysisSnapshot["status"]) {
    if (!from.includes(this.status)) return false;
    this.status = to;
    return true;
  }
  async startExpertRun(input: StartExpertRun) { this.runs.push(input); return input.id; }
  async finishExpertRun() {}
  async saveModule(input: SaveModule) {
    const current = this.modules[input.moduleType];
    if (current.version !== input.expectedVersion) return;
    this.modules[input.moduleType] = { status: input.status, version: input.nextVersion, ...(input.errorCode ? { errorCode: input.errorCode } : {}), ...(input.payload ? { payload: input.payload } : {}) };
    this.saves.push(input);
  }
  async replaceSources() {}
  async appendEvent(input: { eventType: string }) { this.events.push(input.eventType); return this.events.length; }
}

function repository(): MemoryRepository & AnalysisRepository {
  return new MemoryRepository() as MemoryRepository & AnalysisRepository;
}

describe("BaselineOrchestrator", () => {
  it("starts argument, perspectives, sources, and risks independently", async () => {
    const repo = repository();
    const result = await new BaselineOrchestrator(new FakeExpertSuite({ delaysMs: { argument: 0, perspectives: 0, sources: 0, risks: 0 } }), repo).run({ jobId: "job-1" });

    expect(result.status).toBe("completed");
    expect(repo.runs.slice(0, 4).map((run) => run.expertType).sort()).toEqual(["argument", "perspectives", "risks", "sources"]);
    expect(repo.saves.filter((save) => save.status === "running").map((save) => save.moduleType).sort()).toEqual(["argument", "perspectives", "risks", "sources"]);
  });

  it("persists the first fast module before the slow source expert resolves", async () => {
    let releaseSources!: () => void;
    const sources = new Promise<void>((resolve) => { releaseSources = resolve; });
    const suite = new FakeExpertSuite({ delaysMs: { argument: 0, perspectives: 0, risks: 0, sources: 0 } });
    vi.spyOn(suite, "researchSources").mockImplementation(async () => { await sources; return { value: { claims: [], sources: [], relations: [], gaps: [] }, usage: { inputTokens: 0, outputTokens: 0, latencyMs: 0 } }; });
    const repo = repository();
    const pending = new BaselineOrchestrator(suite, repo).run({ jobId: "job-1" });

    await vi.waitFor(() => expect(repo.saves.some((save) => save.moduleType === "argument")).toBe(true));
    releaseSources();
    await pending;
  });

  it("records one expert run per required expert and a second perspective review run", async () => {
    const repo = repository();
    await new BaselineOrchestrator(new FakeExpertSuite({ delaysMs: { argument: 0, perspectives: 0, sources: 0, risks: 0 } }), repo).run({ jobId: "job-1" });

    expect(repo.runs).toEqual(expect.arrayContaining([
      expect.objectContaining({ expertType: "argument", phase: "baseline" }),
      expect.objectContaining({ expertType: "perspectives", phase: "baseline" }),
      expect.objectContaining({ expertType: "sources", phase: "baseline" }),
      expect.objectContaining({ expertType: "risks", phase: "baseline" }),
      expect.objectContaining({ expertType: "perspectives", phase: "second-review" }),
    ]));
  });

  it("synthesizes, reviews, revises, and publishes all six modules", async () => {
    const repo = repository();
    await new BaselineOrchestrator(new FakeExpertSuite({ delaysMs: { argument: 0, perspectives: 0, sources: 0, risks: 0 } }), repo).run({ jobId: "job-1" });

    expect(Object.values(repo.modules).every((module) => module.status === "completed")).toBe(true);
    expect(repo.events).toContain("baseline.completed");
  });

  it("completes as partial when search fails and marks only sources failed", async () => {
    const repo = repository();
    const result = await new BaselineOrchestrator(new FakeExpertSuite({ delaysMs: { argument: 0, perspectives: 0, sources: 0, risks: 0 }, failures: { sources: "SEARCH_UNAVAILABLE" } }), repo).run({ jobId: "job-1" });

    expect(result.status).toBe("partial");
    expect(repo.modules.sources).toMatchObject({ status: "failed", errorCode: "SEARCH_UNAVAILABLE" });
    expect(Object.entries(repo.modules).filter(([moduleType]) => moduleType !== "sources").every(([, module]) => module.status === "completed")).toBe(true);
  });

  it("resumes a recoverable job without rerunning completed independent modules", async () => {
    const repo = repository();
    repo.job.material = "[测试：任务中断]素材中的第一句。";
    const suite = new FakeExpertSuite({ delaysMs: { argument: 0, perspectives: 0, sources: 0, risks: 0 } });
    await new BaselineOrchestrator(suite, repo).run({ jobId: "job-1" });
    const completedVersions = Object.fromEntries(
      Object.entries(repo.modules)
        .filter(([, module]) => module.status === "completed")
        .map(([moduleType, module]) => [moduleType, module.version]),
    );
    repo.runs.length = 0;
    await new BaselineOrchestrator(suite, repo).run({ jobId: "job-1" });

    expect(repo.runs.map((run) => `${run.expertType}:${run.phase}`)).toEqual([
      "perspectives:baseline",
      "synthesis:baseline",
      "perspectives:second-review",
      "synthesis:revision",
    ]);
    for (const [moduleType, version] of Object.entries(completedVersions)) {
      expect(repo.modules[moduleType as keyof typeof repo.modules].version).toBe(version);
    }
  });

  it("reruns one failed module and then re-synthesizes and reviews the report", async () => {
    const repo = repository();
    repo.job.material = "[测试：信源失败一次]素材中的第一句。";
    const suite = new FakeExpertSuite({ delaysMs: { argument: 0, perspectives: 0, sources: 0, risks: 0 } });
    await new BaselineOrchestrator(suite, repo).run({ jobId: "job-1" });
    repo.runs.length = 0;
    await new BaselineOrchestrator(suite, repo).run({ jobId: "job-1", onlyModule: "sources" });

    expect(repo.runs.map((run) => `${run.expertType}:${run.phase}`)).toEqual(["sources:baseline", "synthesis:baseline", "perspectives:second-review", "synthesis:revision"]);
  });

  it("does not let an older run overwrite a newer module version", async () => {
    const repo = repository();
    await new BaselineOrchestrator(new FakeExpertSuite({ delaysMs: { argument: 0, perspectives: 0, sources: 0, risks: 0 } }), repo).run({ jobId: "job-1" });
    repo.status = "partial";
    const saveModule = vi.spyOn(repo, "saveModule");
    await new BaselineOrchestrator(new FakeExpertSuite({ delaysMs: { argument: 0, perspectives: 0, sources: 0, risks: 0 } }), repo).run({ jobId: "job-1" });

    expect(saveModule).not.toHaveBeenCalledWith(expect.objectContaining({ moduleType: "argument", expectedVersion: 0 }));
  });
});
