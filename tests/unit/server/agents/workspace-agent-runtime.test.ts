import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { LangfuseOtelSpanAttributes } from "@langfuse/tracing";
import { NodeSDK, tracing } from "@opentelemetry/sdk-node";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalysisSnapshot } from "@/features/analysis/domain/contracts";
import type { NewAnalysisEvent } from "@/features/analysis/server/analysis-repository";
import type { WorkspaceToolArtifact } from "@/features/analysis/domain/workspace";
import {
  ManagerAgentRuntime,
  type ManagerAgentContextRepository,
  type ManagerAgentSessionInput,
} from "@/server/agents/manager/agent";
import {
  type RunPeerExpertInput,
  type RunReportActionInput,
  type WorkspaceToolExecutor,
  type WorkspaceToolName,
} from "@/server/agents/workspace-tool-executor";

const workspaceId = "workspace-1";
const agentRunId = "run-1";
const exporter = new tracing.InMemorySpanExporter();
const processor = new LangfuseSpanProcessor({ exporter, exportMode: "immediate" });
const sdk = new NodeSDK({ spanProcessors: [processor] });

describe("ManagerAgentRuntime", () => {
  beforeAll(() => sdk.start());
  beforeEach(() => exporter.reset());
  afterAll(() => sdk.shutdown());

  it("runs a Pi session with peer delegation and server-owned context", async () => {
    const repository = baselineRepository();
    const executor = recordingExecutor(repository.complete);
    let sessionInput: ManagerAgentSessionInput | undefined;
    const session = managerSession(async (tools, emit) => {
      const delegate = toolByName(tools, "delegate_expert");
      const action = toolByName(tools, "report_action");
      emit({ type: "turn_start" });
      emit({
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          delta: "正在协调 token=top-secret",
        },
      });
      emit({ type: "turn_end" });
      for (const expert of ["risks", "argument", "sources", "perspectives", "synthesis"] as const) {
        await executeTool(delegate, { expert });
      }
      for (const reportAction of ["review_draft", "revise_report", "publish_report"] as const) {
        await executeTool(action, { action: reportAction });
      }
    });
    const createSession = vi.fn(async (input: ManagerAgentSessionInput) => {
      sessionInput = input;
      session.tools = input.customTools;
      return session;
    });
    const runtime = new ManagerAgentRuntime(createSession, executor, repository);
    const signal = new AbortController().signal;

    await expect(runtime.run({ workspaceId, agentRunId, signal })).resolves.toEqual({
      status: "completed",
    });

    expect(executor.executed).toEqual([
      "review_risks",
      "analyze_argument",
      "research_sources",
      "map_perspectives",
      "synthesize_report",
      "review_draft",
      "revise_report",
      "publish_report",
    ]);
    expect(executor.contexts).toEqual(
      executor.executed.map(() => expect.objectContaining({
        workspaceId,
        agentRunId,
        signal,
      })),
    );
    expect(sessionInput?.customTools.map((tool) => tool.name)).toEqual([
      "delegate_expert",
      "report_action",
    ]);
    expect(session.subscribe).toHaveBeenCalledOnce();
    expect(session.prompt).toHaveBeenCalledWith(expect.stringContaining("基线分析"));
    expect(repository.events.map((event) => event.eventType)).toEqual([
      "agent.ui.run.started",
      "agent.ui.text.started",
      "agent.ui.text.delta",
      "agent.ui.text.finished",
      "agent.ui.run.finished",
    ]);
    expect(JSON.stringify(repository.events)).not.toContain("top-secret");
    await processor.forceFlush();
    const observations = exporter.getFinishedSpans();
    const analysis = observations.find((span) => span.name === "analysis.baseline");
    const manager = observations.find((span) => span.name === "manager");
    expect(analysis?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_INPUT]).toBe(
      JSON.stringify({ material: "material" }),
    );
    expect(manager).toEqual(expect.objectContaining({
      parentSpanContext: expect.objectContaining({ spanId: analysis?.spanContext().spanId }),
    }));
    expect(manager?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_TYPE]).toBe("agent");
  });

  it("returns interrupted when Agent generation is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const session = managerSession(async () => {
      throw controller.signal.reason;
    });
    const runtime = new ManagerAgentRuntime(
      async () => session,
      recordingExecutor(),
      baselineRepository(),
    );

    await expect(
      runtime.run({ workspaceId, agentRunId, signal: controller.signal }),
    ).resolves.toEqual({ status: "interrupted" });
    expect(session.abort).toHaveBeenCalledOnce();
    await processor.forceFlush();
    const interrupted = exporter.getFinishedSpans().filter((span) =>
      span.name === "manager" || span.name === "analysis.baseline"
    );
    expect(interrupted).toHaveLength(2);
    expect(interrupted.every((span) =>
      span.attributes[LangfuseOtelSpanAttributes.OBSERVATION_LEVEL] === "WARNING"
      && span.attributes[LangfuseOtelSpanAttributes.OBSERVATION_STATUS_MESSAGE] === "interrupted"
    )).toBe(true);
  });

  it("rejects a baseline run when the model stops before publishing a valid report", async () => {
    const runtime = new ManagerAgentRuntime(
      async () => managerSession(),
      recordingExecutor(),
      baselineRepository(),
    );

    await expect(runtime.run({
      workspaceId,
      agentRunId,
      signal: new AbortController().signal,
    })).rejects.toThrow("BASELINE_INCOMPLETE");
  });

  it("resumes from durable work without forcing a fixed peer sequence", async () => {
    const repository = baselineRepository({ argumentCompleted: true });
    const executor = recordingExecutor(repository.complete);
    const runtime = new ManagerAgentRuntime(
      async (input) => {
        const session = managerSession(async (tools) => {
          const delegate = toolByName(tools, "delegate_expert");
          const action = toolByName(tools, "report_action");
          for (const expert of ["sources", "risks", "perspectives", "synthesis"] as const) {
            await executeTool(delegate, { expert });
          }
          for (const reportAction of ["review_draft", "revise_report", "publish_report"] as const) {
            await executeTool(action, { action: reportAction });
          }
        });
        session.tools = input.customTools;
        return session;
      },
      executor,
      repository,
    );

    await expect(runtime.run({
      workspaceId,
      agentRunId,
      signal: new AbortController().signal,
    })).resolves.toEqual({ status: "completed" });

    expect(executor.executed).not.toContain("analyze_argument");
  });
});

function recordingExecutor(onExecute?: (name: WorkspaceToolName) => void) {
  const executed: WorkspaceToolName[] = [];
  const contexts: Array<RunPeerExpertInput | RunReportActionInput> = [];
  const complete = (name: WorkspaceToolName, context: RunPeerExpertInput | RunReportActionInput) => {
    executed.push(name);
    contexts.push(context);
    onExecute?.(name);
    return Promise.resolve({ ok: true as const, summary: `${name} completed` });
  };
  return {
    executed,
    contexts,
    runExpert(input: RunPeerExpertInput) {
      const names = {
        argument: "analyze_argument",
        sources: "research_sources",
        perspectives: "map_perspectives",
        risks: "review_risks",
        synthesis: "synthesize_report",
      } as const;
      return complete(names[input.expert], input);
    },
    runReportAction(input: RunReportActionInput) {
      return complete(input.action, input);
    },
  } satisfies Pick<WorkspaceToolExecutor, "runExpert" | "runReportAction"> & {
    executed: WorkspaceToolName[];
    contexts: Array<RunPeerExpertInput | RunReportActionInput>;
  };
}

function baselineRepository(
  options: {
    argumentCompleted?: boolean;
    persistedStep?: "synthesis" | "revision" | "stale-revision";
  } = {},
): ManagerAgentContextRepository & {
  complete(name: WorkspaceToolName): void;
  events: NewAnalysisEvent[];
} {
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
  const events: NewAnalysisEvent[] = [];
  return {
    events,
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
    async appendEvent(event) {
      events.push(event);
      return events.length;
    },
  } as ManagerAgentContextRepository & {
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

function managerSession(run?: (
  tools: ToolDefinition[],
  emit: (event: unknown) => void,
) => Promise<void>) {
  let tools: ToolDefinition[] = [];
  let listener: (event: unknown) => void = () => {};
  return {
    set tools(value: ToolDefinition[]) { tools = value; },
    prompt: vi.fn(async () => run?.(tools, (event) => listener(event))),
    waitForIdle: vi.fn(),
    subscribe: vi.fn((next: (event: unknown) => void) => {
      listener = next;
      return () => { listener = () => {}; };
    }),
    abort: vi.fn(),
    dispose: vi.fn(),
  };
}

function toolByName(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

function executeTool(tool: ToolDefinition, params: Record<string, unknown>) {
  return tool.execute("call", params, undefined, undefined, undefined as never);
}
