import { describe, expect, it } from "vitest";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";

import type { AnalysisSnapshot } from "@/features/analysis/domain/contracts";
import type { WorkspaceToolArtifact } from "@/features/analysis/domain/workspace";
import {
  WorkspaceAgentRuntime,
  type WorkspaceAgentContextRepository,
} from "@/server/agents/workspace-agent-runtime";
import {
  workspaceToolNames,
  type AgentToolContext,
  type WorkspaceToolExecutor,
  type WorkspaceToolName,
} from "@/server/agents/workspace-tool-executor";

const workspaceId = "workspace-1";
const agentRunId = "run-1";

describe("WorkspaceAgentRuntime", () => {
  it("runs ToolLoopAgent with only workspace tools and server-owned context", async () => {
    const repository = baselineRepository();
    const executor = recordingExecutor(repository.complete);
    const model = toolLoopModel([
      ["analyze_argument", "research_sources", "map_perspectives", "review_risks"],
      ["synthesize_report"],
      ["review_draft"],
      ["revise_report"],
      ["publish_report"],
    ]);
    const runtime = new WorkspaceAgentRuntime(model, executor, repository);
    const signal = new AbortController().signal;

    await expect(runtime.run({ workspaceId, agentRunId, signal })).resolves.toEqual({
      status: "completed",
    });

    expect(executor.executed).toEqual([
      "analyze_argument",
      "research_sources",
      "map_perspectives",
      "review_risks",
      "synthesize_report",
      "review_draft",
      "revise_report",
      "publish_report",
    ]);
    expect(executor.contexts).toEqual(
      executor.executed.map(() => ({
        workspaceId,
        agentRunId,
        userId: "user-1",
        signal,
        kind: "baseline",
        completedTools: [],
      })),
    );
    expect(
      model.doStreamCalls[0]?.tools?.map((candidate) => candidate.name).sort(),
    ).toEqual(workspaceToolNames.filter((name) => name !== "review_target").sort());
    expect(model.doStreamCalls[0]?.abortSignal).toBe(signal);
  });

  it("returns interrupted when Agent generation is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const model = new MockLanguageModelV4({
      doGenerate: async ({ abortSignal }) => {
        expect(abortSignal).toBe(controller.signal);
        throw abortSignal?.reason;
      },
    });
    const runtime = new WorkspaceAgentRuntime(
      model,
      recordingExecutor(),
      baselineRepository(),
    );

    await expect(
      runtime.run({ workspaceId, agentRunId, signal: controller.signal }),
    ).resolves.toEqual({ status: "interrupted" });
  });

  it("rejects a baseline run when the model stops before publishing a valid report", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => textStream("done"),
    });
    const runtime = new WorkspaceAgentRuntime(
      model,
      recordingExecutor(),
      baselineRepository(),
    );

    await expect(runtime.run({
      workspaceId,
      agentRunId,
      signal: new AbortController().signal,
    })).rejects.toThrow("BASELINE_INCOMPLETE");
  });

  it("rejects a baseline run when the model exhausts the tool-loop step limit", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => toolStream(["analyze_argument"]),
    });
    const runtime = new WorkspaceAgentRuntime(
      model,
      recordingExecutor(),
      baselineRepository(),
    );

    await expect(runtime.run({
      workspaceId,
      agentRunId,
      signal: new AbortController().signal,
    })).rejects.toThrow("BASELINE_INCOMPLETE");
    expect(model.doStreamCalls).toHaveLength(16);
  });

  it("does not expose a baseline tool whose module was durably completed before cancellation", async () => {
    const repository = baselineRepository({ argumentCompleted: true });
    const executor = recordingExecutor(repository.complete);
    const model = toolLoopModel([
      ["research_sources", "map_perspectives", "review_risks"],
      ["synthesize_report"],
      ["review_draft"],
      ["revise_report"],
      ["publish_report"],
    ]);
    const runtime = new WorkspaceAgentRuntime(model, executor, repository);

    await expect(runtime.run({
      workspaceId,
      agentRunId,
      signal: new AbortController().signal,
    })).resolves.toEqual({ status: "completed" });

    expect(model.doStreamCalls[0]?.tools?.map((candidate) => candidate.name)).not.toContain(
      "analyze_argument",
    );
    expect(executor.executed).not.toContain("analyze_argument");
  });
});

function recordingExecutor(onExecute?: (name: WorkspaceToolName) => void) {
  const executed: WorkspaceToolName[] = [];
  const contexts: AgentToolContext[] = [];
  return {
    executed,
    contexts,
    async execute(name: WorkspaceToolName, context: AgentToolContext) {
      executed.push(name);
      contexts.push(context);
      onExecute?.(name);
      return { ok: true as const, summary: `${name} completed` };
    },
  } satisfies Pick<WorkspaceToolExecutor, "execute"> & {
    executed: WorkspaceToolName[];
    contexts: AgentToolContext[];
  };
}

function baselineRepository(
  options: {
    argumentCompleted?: boolean;
    persistedStep?: "synthesis" | "revision" | "stale-revision";
  } = {},
): WorkspaceAgentContextRepository & { complete(name: WorkspaceToolName): void } {
  const completedBaseline = options.persistedStep !== undefined;
  const currentVersions = moduleVersions(1);
  const synthesisInput = { ...moduleVersions(1), overview: 0, reflection: 0 };
  const synthesisOutput = moduleVersions(1);
  const artifacts: Partial<Record<WorkspaceToolName, WorkspaceToolArtifact[]>> = completedBaseline
    ? {
        synthesize_report: [{
          kind: "synthesis",
          inputVersions: synthesisInput,
          outputVersions: synthesisOutput,
        }],
        ...(options.persistedStep === "revision" || options.persistedStep === "stale-revision"
          ? {
              review_draft: [{
                kind: "draft_review" as const,
                review: { findings: [] },
                inputVersions: synthesisOutput,
              }],
              revise_report: [{
                kind: "revision" as const,
                inputVersions: synthesisOutput,
                outputVersions: options.persistedStep === "stale-revision"
                  ? moduleVersions(2)
                  : synthesisOutput,
              }],
            }
          : {}),
      }
    : {};
  const snapshot: AnalysisSnapshot = {
    workspaceId,
    reportId: "report-1",
    currentVersion: 0,
    status: "running",
    configVersion: "agent-v1",
    materialPreview: "material",
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    lastEventId: 0,
    activeRun: {
      id: agentRunId,
      workspaceId,
      kind: "baseline",
      status: "running",
      configVersion: "agent-v1",
      cancellationRequestedAt: null,
      startedAt: "2026-08-02T00:00:00.000Z",
      completedAt: null,
    },
    toolCalls: options.argumentCompleted
      ? [{
          id: "unfinished-call-1",
          agentRunId: "cancelled-run-1",
          toolName: "analyze_argument",
          status: "running",
          summary: "正在核对核心主张。",
          errorCode: null,
          createdAt: "2026-08-02T00:00:00.000Z",
          completedAt: null,
        }]
      : options.persistedStep === "synthesis" || options.persistedStep === "revision"
        ? [{
            id: "unfinished-call-1",
            agentRunId: "cancelled-run-1",
            toolName: options.persistedStep === "synthesis" ? "synthesize_report" : "revise_report",
            status: "running",
            summary: "工具输出已保存。",
            errorCode: null,
            createdAt: "2026-08-02T00:00:00.000Z",
            completedAt: null,
          }]
        : [],
    messages: [],
    revisions: [],
    modules: Object.fromEntries(
      ["overview", "argument", "perspectives", "sources", "risks", "reflection"].map(
        (moduleType) => [moduleType, { status: "queued", version: 0 }],
      ),
    ) as AnalysisSnapshot["modules"],
  };
  if (options.argumentCompleted) {
    snapshot.modules.argument = { status: "completed", version: 1 };
  }
  if (completedBaseline) {
    for (const moduleType of Object.keys(snapshot.modules) as Array<keyof typeof snapshot.modules>) {
      snapshot.modules[moduleType] = {
        status: "completed",
        version: currentVersions[moduleType],
      };
    }
  }
  const completedToolNames = new Set<WorkspaceToolName>(completedBaseline
    ? [
        "analyze_argument",
        "research_sources",
        "map_perspectives",
        "review_risks",
        ...(options.persistedStep === "revision" || options.persistedStep === "stale-revision"
          ? [
              "synthesize_report" as const,
              "review_draft" as const,
              ...(options.persistedStep === "stale-revision" ? ["revise_report" as const] : []),
            ]
          : []),
      ]
    : []);
  return {
    complete(name) {
      completedToolNames.add(name);
      const moduleType = baselineModuleType(name);
      if (moduleType) {
        snapshot.modules[moduleType] = { status: "completed", version: 1 };
      } else if (name === "synthesize_report") {
        snapshot.modules.overview = { status: "completed", version: 1 };
        snapshot.modules.reflection = { status: "completed", version: 1 };
        artifacts.synthesize_report = [{
          kind: "synthesis",
          inputVersions: { ...moduleVersions(1), overview: 0, reflection: 0 },
          outputVersions: moduleVersions(1),
        }];
      } else if (name === "review_draft") {
        artifacts.review_draft = [{
          kind: "draft_review",
          review: { findings: [] },
          inputVersions: moduleVersions(1),
        }];
      } else if (name === "revise_report") {
        artifacts.revise_report = [{
          kind: "revision",
          inputVersions: moduleVersions(1),
          outputVersions: moduleVersions(1),
        }];
      }
    },
    async getJobForExecution() {
      return {
        jobId: workspaceId,
        userId: "user-1",
        reportId: "report-1",
        material: "material",
        detectedLanguage: "zh" as const,
        status: "running" as const,
        configVersion: "agent-v1",
      };
    },
    async getOwnedSnapshot() {
      return snapshot;
    },
    async listCompletedWorkspaceToolNames() {
      return [...completedToolNames];
    },
    async listPersistedAgentToolArtifacts(input: { toolName: WorkspaceToolName }) {
      return artifacts[input.toolName] ?? [];
    },
    async appendEvent() {
      return 1;
    },
  } as WorkspaceAgentContextRepository & {
    complete(name: WorkspaceToolName): void;
    listPersistedAgentToolArtifacts(input: {
      toolName: WorkspaceToolName;
    }): Promise<WorkspaceToolArtifact[]>;
  };
}

function baselineModuleType(name: WorkspaceToolName) {
  if (name === "analyze_argument") return "argument" as const;
  if (name === "research_sources") return "sources" as const;
  if (name === "map_perspectives") return "perspectives" as const;
  if (name === "review_risks") return "risks" as const;
  return undefined;
}

function moduleVersions(argument = 1) {
  return {
    overview: 1,
    argument,
    perspectives: 1,
    sources: 1,
    risks: 1,
    reflection: 1,
  };
}

function toolLoopModel(steps: WorkspaceToolName[][]): MockLanguageModelV4 {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const toolNames = steps[call++];
      return toolNames ? toolStream(toolNames, call) : textStream("done");
    },
  });
}

function textStream(text: string) {
  return streamResult([
    { type: "text-start" as const, id: "text-1" },
    { type: "text-delta" as const, id: "text-1", delta: text },
    { type: "text-end" as const, id: "text-1" },
  ], "stop");
}

function toolStream(toolNames: WorkspaceToolName[], call = 0) {
  return streamResult(toolNames.map((toolName, index) => ({
    type: "tool-call" as const,
    toolCallId: `call-${call}-${index}`,
    toolName,
    input: "{}",
  })), "tool-calls");
}

function streamResult(chunks: object[], finishReason: "stop" | "tool-calls") {
  return {
    stream: simulateReadableStream({
      chunks: [...chunks, {
        type: "finish" as const,
        finishReason: { unified: finishReason, raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
      }],
    }),
  };
}
