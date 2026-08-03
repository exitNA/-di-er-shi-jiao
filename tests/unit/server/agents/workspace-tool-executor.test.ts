import { describe, expect, it } from "vitest";

import {
  moduleTypes,
  type AnalysisSnapshot,
  type BaselineDraft,
  type ReportModuleType,
} from "@/features/analysis/domain/contracts";
import type {
  AnalysisRepository,
  ExecutionJob,
  FinishAgentToolCall,
  NewAgentToolCall,
  SaveModule,
  SaveRevisionDraft,
} from "@/features/analysis/server/analysis-repository";
import type { WorkspaceToolArtifact } from "@/features/analysis/domain/workspace";
import type {
  DraftRevisionInput,
  ExpertResult,
  ExpertSuite,
} from "@/server/agents/expert-suite";
import {
  WorkspaceToolExecutor,
  type AgentToolContext,
  type WorkspaceToolName,
} from "@/server/agents/workspace-tool-executor";
import { createStubExpertSuite } from "../../../helpers/stub-expert-suite";

const material = "raw-secret：素材中的第一句。第二句。";
const now = new Date("2026-08-02T00:00:00.000Z");

class MemoryRepository {
  readonly job: ExecutionJob = {
    jobId: "workspace-1",
    userId: "user-1",
    reportId: "report-1",
    material,
    detectedLanguage: "zh",
    status: "running",
    configVersion: "agent-v1",
  };
  readonly modules = Object.fromEntries(
    ["overview", "argument", "perspectives", "sources", "risks", "reflection"].map((moduleType) => [
      moduleType,
      { status: "queued", version: 0 },
    ]),
  ) as AnalysisSnapshot["modules"];
  readonly toolCalls: AnalysisSnapshot["toolCalls"] = [];
  readonly artifacts = new Map<string, WorkspaceToolArtifact>();
  readonly persistedArtifacts = new Map<string, WorkspaceToolArtifact>();
  readonly completedToolHistory = new Set<string>();
  readonly rejectedFinishes = new Set<string>();
  readonly events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  runStatus: "running" | "interrupted" = "running";
  cancelAfterModule?: ReportModuleType;

  async getJobForExecution() { return this.job; }

  async getOwnedSnapshot() {
    return {
      workspaceId: this.job.jobId,
      reportId: this.job.reportId,
      currentVersion: 0,
      status: "running" as const,
      configVersion: this.job.configVersion,
      materialPreview: material.slice(0, 80),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      lastEventId: 0,
      activeRun: {
        id: "run-1",
        workspaceId: this.job.jobId,
        kind: "baseline" as const,
        status: this.runStatus,
        configVersion: this.job.configVersion,
        cancellationRequestedAt: this.runStatus === "interrupted" ? now.toISOString() : null,
        startedAt: now.toISOString(),
        completedAt: null,
      },
      toolCalls: structuredClone(this.toolCalls),
      messages: [],
      revisions: [],
      modules: structuredClone(this.modules),
    };
  }

  async appendAgentToolCall(input: NewAgentToolCall) {
    const id = `call-${this.toolCalls.length + 1}`;
    this.toolCalls.push({
      id,
      agentRunId: input.agentRunId,
      toolName: input.toolName,
      status: "running",
      summary: input.summary,
      errorCode: null,
      createdAt: input.now.toISOString(),
      completedAt: null,
    });
    return { id };
  }

  async finishAgentToolCall(input: FinishAgentToolCall) {
    const call = this.toolCalls.find((candidate) => candidate.id === input.id);
    if (!call || call.status !== "running" || this.runStatus !== "running") return false;
    if (this.rejectedFinishes.has(call.toolName)) return false;
    Object.assign(call, {
      status: input.status,
      summary: input.summary,
      errorCode: input.errorCode ?? null,
      completedAt: input.now.toISOString(),
    });
    if (input.artifact) {
      this.artifacts.set(`${input.agentRunId}:${call.toolName}`, input.artifact);
      this.persistedArtifacts.set(`${input.agentRunId}:${call.toolName}`, input.artifact);
    }
    if (input.status === "completed") this.completedToolHistory.add(call.toolName);
    return true;
  }

  async findCompletedAgentToolArtifact(input: { toolName: string }) {
    return this.artifacts.get(`run-1:${input.toolName}`) ?? null;
  }

  async listCompletedAgentToolArtifacts(input: { toolName: string }) {
    const artifact = await this.findCompletedAgentToolArtifact(input);
    return artifact ? [artifact] : [];
  }

  async saveAgentToolArtifact(input: {
    agentRunId: string;
    id: string;
    artifact: WorkspaceToolArtifact;
  }) {
    const call = this.toolCalls.find((candidate) => candidate.id === input.id);
    if (!call || call.status !== "running") return false;
    this.persistedArtifacts.set(`${input.agentRunId}:${call.toolName}`, input.artifact);
    return true;
  }

  async listPersistedAgentToolArtifacts(input: { toolName: string }) {
    const artifact = this.persistedArtifacts.get(`run-1:${input.toolName}`);
    return artifact ? [artifact] : [];
  }

  async listCompletedWorkspaceToolNames() {
    return [...this.completedToolHistory];
  }

  async saveModule(input: SaveModule) {
    const current = this.modules[input.moduleType];
    if (current.version !== input.expectedVersion) return;
    this.modules[input.moduleType] = {
      status: input.status,
      version: input.nextVersion,
      ...(input.payload ? { payload: input.payload } : {}),
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    };
    if (this.cancelAfterModule === input.moduleType) this.interruptRun();
  }

  async saveRevisionDraft(input: SaveRevisionDraft) {
    const staged = structuredClone(this.modules);
    for (const moduleType of moduleTypes) {
      const current = staged[moduleType];
      if (current.version !== input.expectedVersions[moduleType]) return false;
      staged[moduleType] = {
        status: "completed",
        version: input.nextVersions[moduleType],
        payload: input.draft[moduleType],
      };
      if (this.cancelAfterModule === moduleType) this.interruptRun();
    }
    Object.assign(this.modules, staged);
    return true;
  }

  async saveSourcesModule(input: SaveModule) { return this.saveModule(input); }

  async replaceSources() {}
  async appendEvent(input: { eventType: string; payload: Record<string, unknown> }) {
    this.events.push(input);
    return this.events.length;
  }
  async startExpertRun(input: { id: string }) { return input.id; }
  async finishExpertRun() {}

  private interruptRun() {
    this.runStatus = "interrupted";
    this.rejectedFinishes.add("revise_report");
  }
}

function setup(experts: ExpertSuite = createStubExpertSuite()) {
  const repository = new MemoryRepository() as MemoryRepository & AnalysisRepository;
  const executor = new WorkspaceToolExecutor(
    experts,
    repository,
    () => now,
  );
  const context: AgentToolContext = { workspaceId: "workspace-1", agentRunId: "run-1" };
  return { executor, repository, context };
}

describe("WorkspaceToolExecutor", () => {
  it("passes a targeted delegation task to the selected expert", async () => {
    const base = createStubExpertSuite();
    let receivedTask: string | undefined;
    const { executor, context } = setup(createStubExpertSuite({
      analyzeArgument(input) {
        receivedTask = input.task;
        return base.analyzeArgument(input);
      },
    }));

    await executor.runExpert({ ...context, expert: "argument", task: "只核对因果跳跃" });

    expect(receivedTask).toBe("只核对因果跳跃");
  });

  it("uses predefined expert results without external services", async () => {
    const experts = createStubExpertSuite();

    await expect(experts.analyzeArgument({ material: "材料" })).resolves.toEqual(
      expect.objectContaining({
        usage: { inputTokens: 0, outputTokens: 0, latencyMs: 0 },
      }),
    );
  });

  it("applies the tool-call budget to the current Agent run only", async () => {
    const { executor, repository, context } = setup();
    repository.toolCalls.push(...Array.from({ length: 16 }, (_, index) => ({
      id: `old-call-${index}`,
      agentRunId: "old-run",
      toolName: "analyze_argument",
      status: "completed" as const,
      summary: "历史运行摘要。",
      errorCode: null,
      createdAt: now.toISOString(),
      completedAt: now.toISOString(),
    })));

    await expect(executor.runExpert({ ...context, expert: "argument" })).resolves.toMatchObject({ ok: true });
  });

  it("refuses publication until synthesis and second review succeeded", async () => {
    const { executor, context } = setup();

    const result = await executor.runReportAction({ ...context, action: "publish_report" });

    expect(result).toEqual({ ok: false, code: "REQUIRED_TOOL_UNAVAILABLE" });
  });

  it("publishes the expert output and omits its prompt", async () => {
    const { executor, repository, context } = setup();

    await executor.execute("analyze_argument", context);

    expect(repository.toolCalls[0]).toMatchObject({
      toolName: "analyze_argument",
      summary: expect.any(String),
    });
    expect(repository.toolCalls[0]).not.toHaveProperty("prompt");
    expect(repository.toolCalls[0]).not.toHaveProperty("rawOutput");
    expect(repository.toolCalls[0]?.summary).not.toContain("raw-secret");
    expect(repository.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: "agent.ui.run.started" }),
      expect.objectContaining({ eventType: "agent.ui.activity" }),
      expect.objectContaining({ eventType: "agent.ui.run.finished" }),
    ]));
  });

  it("loads persisted second-review findings without rewriting unchanged modules", async () => {
    const { executor, repository, context } = setup();
    const tools: WorkspaceToolName[] = [
      "analyze_argument",
      "research_sources",
      "map_perspectives",
      "review_risks",
      "synthesize_report",
      "review_draft",
    ];
    for (const toolName of tools) expect(await executor.execute(toolName, context)).toMatchObject({ ok: true });

    expect(repository.artifacts.get("run-1:review_draft")).toEqual({
      kind: "draft_review",
      review: { findings: [] },
      inputVersions: { overview: 1, argument: 1, perspectives: 1, sources: 1, risks: 1, reflection: 1 },
    });
    repository.toolCalls.length = 0;
    expect(await executor.execute("revise_report", context)).toMatchObject({ ok: true });
    expect(await executor.execute("publish_report", context)).toMatchObject({ ok: true });
    expect(Object.values(repository.modules).every((module) => module.status === "completed")).toBe(true);
    expect(Object.values(repository.modules).every((module) => module.version === 1)).toBe(true);
  });

  it("rejects publication after a baseline module is rerun past the reviewed revision", async () => {
    const { executor, context } = setup();
    const tools: WorkspaceToolName[] = [
      "analyze_argument",
      "research_sources",
      "map_perspectives",
      "review_risks",
      "synthesize_report",
      "review_draft",
      "revise_report",
    ];
    for (const toolName of tools) await executor.execute(toolName, context);

    await executor.execute("analyze_argument", context);

    expect(await executor.execute("publish_report", context)).toEqual({
      ok: false,
      code: "REQUIRED_TOOL_UNAVAILABLE",
    });
  });

  it("rejects revision when synthesis is rerun after the saved review", async () => {
    const { executor, context } = setup();
    const tools: WorkspaceToolName[] = [
      "analyze_argument",
      "research_sources",
      "map_perspectives",
      "review_risks",
      "synthesize_report",
      "review_draft",
    ];
    for (const toolName of tools) await executor.execute(toolName, context);

    await executor.execute("synthesize_report", context);

    expect(await executor.execute("revise_report", context)).toEqual({
      ok: false,
      code: "REQUIRED_TOOL_UNAVAILABLE",
    });
  });

  it("rebuilds the minimal downstream chain after a partially persisted revision", async () => {
    const { executor, repository, context } = setup();
    for (const toolName of [
      "analyze_argument",
      "research_sources",
      "map_perspectives",
      "review_risks",
      "synthesize_report",
      "review_draft",
    ] as const) {
      await executor.execute(toolName, context);
    }
    const argument = repository.modules.argument;
    if (!argument.payload) throw new Error("Expected persisted argument module");
    await repository.saveModule({
      jobId: repository.job.jobId,
      reportId: repository.job.reportId,
      userId: repository.job.userId,
      moduleType: "argument",
      status: "completed",
      payload: argument.payload,
      expectedVersion: 1,
      nextVersion: 2,
      now,
    });

    for (const toolName of ["synthesize_report", "review_draft", "revise_report"] as const) {
      expect(await executor.execute(toolName, context)).toMatchObject({ ok: true });
    }

    expect(await executor.execute("publish_report", context)).toMatchObject({ ok: true });
  });

  it("keeps source references atomic when cancellation lands during revision persistence", async () => {
    const { executor, repository, context } = setup(sourceChangingExpertSuite());
    for (const toolName of [
      "analyze_argument",
      "research_sources",
      "map_perspectives",
      "review_risks",
      "synthesize_report",
      "review_draft",
    ] as const) {
      await executor.execute(toolName, context);
    }
    repository.cancelAfterModule = "argument";

    expect(await executor.execute("revise_report", context)).toEqual({
      ok: false,
      code: "AGENT_RUN_INTERRUPTED",
    });
    expect(repository.modules.argument.payload).toMatchObject({
      claims: [expect.objectContaining({ sourceId: "source-new" })],
    });
    expect(repository.modules.sources.payload).toMatchObject({
      sources: [expect.objectContaining({ id: "source-new" })],
    });

    repository.runStatus = "running";
    repository.cancelAfterModule = undefined;
    repository.rejectedFinishes.delete("revise_report");
    expect(await executor.execute("publish_report", context)).toMatchObject({ ok: true });
  });

  it("persists synthesis evidence before the completed marker can be rejected", async () => {
    const { executor, repository, context } = setup();
    for (const toolName of [
      "analyze_argument",
      "research_sources",
      "map_perspectives",
      "review_risks",
    ] as const) {
      await executor.execute(toolName, context);
    }
    repository.rejectedFinishes.add("synthesize_report");

    expect(await executor.execute("synthesize_report", context)).toEqual({
      ok: false,
      code: "AGENT_RUN_INTERRUPTED",
    });

    expect(repository.modules.overview.version).toBe(1);
    expect(repository.modules.reflection.version).toBe(1);
    expect(repository.persistedArtifacts.get("run-1:synthesize_report")).toEqual({
      kind: "synthesis",
      inputVersions: { overview: 0, argument: 1, perspectives: 1, sources: 1, risks: 1, reflection: 0 },
      outputVersions: { overview: 1, argument: 1, perspectives: 1, sources: 1, risks: 1, reflection: 1 },
    });
  });

  it("persists revision evidence when all relevant outputs precede the completed marker", async () => {
    const { executor, repository, context } = setup();
    for (const toolName of [
      "analyze_argument",
      "research_sources",
      "map_perspectives",
      "review_risks",
      "synthesize_report",
      "review_draft",
    ] as const) {
      await executor.execute(toolName, context);
    }
    repository.rejectedFinishes.add("revise_report");

    expect(await executor.execute("revise_report", context)).toEqual({
      ok: false,
      code: "AGENT_RUN_INTERRUPTED",
    });

    expect(repository.persistedArtifacts.get("run-1:revise_report")).toEqual({
      kind: "revision",
      inputVersions: { overview: 1, argument: 1, perspectives: 1, sources: 1, risks: 1, reflection: 1 },
      outputVersions: { overview: 1, argument: 1, perspectives: 1, sources: 1, risks: 1, reflection: 1 },
    });
  });
});

function sourceChangingExpertSuite(): ExpertSuite {
  return createStubExpertSuite({
    async reviseDraft(input: DraftRevisionInput): Promise<ExpertResult<BaselineDraft>> {
      const source = {
        id: "source-new",
        title: "新的权威来源",
        url: "https://example.com/source-new",
        domain: "example.com",
        publisher: "Example",
        publishedAt: "2026-08-01",
        qualityTier: 1 as const,
        excerpt: "新的外部证据。",
      };
      const claim = {
        id: "external-claim",
        text: "新的外部证据支持该主张。",
        origin: "external_source" as const,
        sourceId: source.id,
        confidence: { score: 0.9, rationale: "来自新增权威来源" },
      };
      return {
        value: {
          ...input.draft,
          argument: { ...input.draft.argument, claims: [claim] },
          sources: { ...input.draft.sources, sources: [source] },
        },
        usage: { inputTokens: 0, outputTokens: 0, latencyMs: 0 },
      };
    },
  });
}
