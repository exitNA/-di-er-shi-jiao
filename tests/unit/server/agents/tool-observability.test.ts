import { LangfuseSpanProcessor } from "@langfuse/otel";
import { LangfuseOtelSpanAttributes } from "@langfuse/tracing";
import { NodeSDK, tracing } from "@opentelemetry/sdk-node";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createSourceSearchTool } from "@/server/agents/sources/tools/search";
import type { AnalysisSnapshot } from "@/features/analysis/domain/contracts";
import type { AnalysisRepository } from "@/features/analysis/server/analysis-repository";
import { WorkspaceToolExecutor } from "@/server/agents/workspace-tool-executor";
import { withAnalysisTrace } from "@/server/observability/observations";
import { createStubExpertSuite } from "../../../helpers/stub-expert-suite";

const exporter = new tracing.InMemorySpanExporter();
const processor = new LangfuseSpanProcessor({ exporter, exportMode: "immediate" });
const sdk = new NodeSDK({ spanProcessors: [processor] });

function parseAttribute(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function observations() {
  return exporter.getFinishedSpans().map((span) => ({
    name: span.name,
    traceId: span.spanContext().traceId,
    spanId: span.spanContext().spanId,
    parentSpanId: span.parentSpanContext?.spanId,
    asType: span.attributes[LangfuseOtelSpanAttributes.OBSERVATION_TYPE],
    input: parseAttribute(span.attributes[LangfuseOtelSpanAttributes.OBSERVATION_INPUT]),
    output: parseAttribute(span.attributes[LangfuseOtelSpanAttributes.OBSERVATION_OUTPUT]),
    level: span.attributes[LangfuseOtelSpanAttributes.OBSERVATION_LEVEL],
    statusMessage: span.attributes[LangfuseOtelSpanAttributes.OBSERVATION_STATUS_MESSAGE],
  }));
}

describe("agent tool observability", () => {
  beforeAll(() => sdk.start());
  beforeEach(() => exporter.reset());
  afterAll(() => sdk.shutdown());

  it("records complete search input, source URLs and results under the active trace", async () => {
    const searchClient = {
      search: vi.fn(async () => [{
        title: "Example evidence",
        url: "https://example.com/report?utm_source=test",
        domain: "example.com",
        content: "Complete search result",
        publishedAt: "2026-08-03",
        score: 0.9,
      }]),
    };
    const tool = createSourceSearchTool({ searchClient, material: "待分析材料" });

    await withAnalysisTrace(
      { workspaceId: "w1", userId: "u1", kind: "baseline", material: "待分析材料" },
      () => tool.execute("call-1", {}, undefined, undefined, undefined as never),
    );
    await processor.forceFlush();

    const recorded = observations();
    const analysis = recorded.find(({ name }) => name === "analysis.baseline");
    const search = recorded.find(({ name }) => name === "sources.search");

    expect(search).toEqual(expect.objectContaining({
      name: "sources.search",
      asType: "retriever",
      input: expect.objectContaining({
        material: "待分析材料",
        queries: expect.arrayContaining([expect.stringContaining("待分析材料")]),
      }),
      output: {
        candidates: [expect.objectContaining({
          url: "https://example.com/report",
          content: "Complete search result",
        })],
      },
    }));
    expect(search).toEqual(expect.objectContaining({
      traceId: analysis?.traceId,
      parentSpanId: analysis?.spanId,
    }));
  });

  it("marks recovered production failures as errors and records persisted versions", async () => {
    const success = productionExecutor();
    const failure = productionExecutor(new Error("provider exploded"));

    await withAnalysisTrace(
      { workspaceId: "w1", userId: "u1", kind: "baseline", material: "原始材料" },
      async () => {
        await success.executor.runExpert({
          workspaceId: "w1",
          agentRunId: "r1",
          expert: "argument",
        });
        await failure.executor.runExpert({
          workspaceId: "w1",
          agentRunId: "r1",
          expert: "argument",
        });
        await success.executor.runReportAction({
          workspaceId: "w1",
          agentRunId: "r1",
          action: "publish_report",
        });
      },
    );
    await processor.forceFlush();

    expect(success.persistedArtifact).toEqual({
      kind: "baseline_module",
      moduleType: "argument",
      outputVersion: 1,
    });
    expect(observations().filter(({ name }) => name === "workspace.analyze_argument"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          output: expect.objectContaining({
            ok: true,
            artifact: success.persistedArtifact,
          }),
        }),
        expect.objectContaining({
          level: "ERROR",
          statusMessage: "EXPERT_FAILED",
          output: { ok: false, code: "EXPERT_FAILED" },
        }),
      ]));
    expect(observations()).toContainEqual(expect.objectContaining({
      name: "workspace.publish_report",
      level: "ERROR",
      statusMessage: "REQUIRED_TOOL_UNAVAILABLE",
      output: { ok: false, code: "REQUIRED_TOOL_UNAVAILABLE" },
    }));
  });

  it("records and rethrows source search errors", async () => {
    const tool = createSourceSearchTool({
      material: "失败材料",
      searchClient: { search: vi.fn(async () => { throw new Error("search failed"); }) },
    });

    await expect(tool.execute("call-1", {}, undefined, undefined, undefined as never))
      .rejects.toThrow("search failed");
    await processor.forceFlush();

    expect(observations()).toContainEqual(expect.objectContaining({
      name: "sources.search",
      asType: "retriever",
      level: "ERROR",
      statusMessage: "search failed",
      output: { error: "search failed" },
    }));
  });
});

function productionExecutor(error?: Error) {
  const snapshot: AnalysisSnapshot = {
    workspaceId: "w1",
    reportId: "report-1",
    currentVersion: 0,
    status: "running",
    configVersion: "agent-v1",
    materialPreview: "原始材料",
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    lastEventId: 0,
    activeRun: {
      id: "r1",
      workspaceId: "w1",
      kind: "baseline",
      status: "running",
      configVersion: "agent-v1",
      cancellationRequestedAt: null,
      startedAt: "2026-08-02T00:00:00.000Z",
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
  let persistedArtifact: unknown;
  const repository = {
    async getJobForExecution() {
      return {
        jobId: "w1",
        userId: "u1",
        reportId: "report-1",
        material: "原始材料",
        detectedLanguage: "zh" as const,
        status: "running" as const,
        configVersion: "agent-v1",
      };
    },
    async getOwnedSnapshot() { return snapshot; },
    async appendAgentToolCall() { return { id: "call-1" }; },
    async appendEvent() { return 1; },
    async startExpertRun() { return "expert-run-1"; },
    async finishExpertRun() {},
    async saveModule(input: { status: string; payload?: unknown; nextVersion: number }) {
      if (input.status === "completed") {
        snapshot.modules.argument = {
          status: "completed",
          version: input.nextVersion,
          payload: input.payload,
        };
      }
      return true;
    },
    async saveAgentToolArtifact(input: { artifact: unknown }) {
      persistedArtifact = input.artifact;
      return true;
    },
    async listPersistedAgentToolArtifacts() { return []; },
    async finishAgentToolCall() { return true; },
  } as unknown as AnalysisRepository;
  const experts = createStubExpertSuite(error
    ? { async analyzeArgument() { throw error; } }
    : undefined);
  return {
    executor: new WorkspaceToolExecutor(experts, repository),
    get persistedArtifact() { return persistedArtifact; },
  };
}
