import { LangfuseSpanProcessor } from "@langfuse/otel";
import { LangfuseOtelSpanAttributes } from "@langfuse/tracing";
import { NodeSDK, tracing } from "@opentelemetry/sdk-node";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createSourceSearchTool } from "@/server/agents/sources/tools/search";
import {
  WorkspaceToolExecutor,
  type AgentToolResult,
} from "@/server/agents/workspace-tool-executor";
import { withAnalysisTrace } from "@/server/observability/langfuse";

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

    expect(observations()).toContainEqual(expect.objectContaining({
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
  });

  it("records expert and report action inputs and actual executor results", async () => {
    const executor = Object.create(WorkspaceToolExecutor.prototype) as WorkspaceToolExecutor;
    const results: AgentToolResult[] = [
      { ok: true, summary: "argument completed" },
      { ok: true, summary: "report published" },
    ];
    vi.spyOn(executor, "execute")
      .mockResolvedValueOnce(results[0])
      .mockResolvedValueOnce(results[1]);

    await withAnalysisTrace(
      { workspaceId: "w1", userId: "u1", kind: "baseline", material: "原始材料" },
      async () => {
        await executor.runExpert({
          workspaceId: "w1",
          agentRunId: "r1",
          expert: "argument",
          task: "核对论证",
        });
        await executor.runReportAction({
          workspaceId: "w1",
          agentRunId: "r1",
          action: "publish_report",
        });
      },
    );
    await processor.forceFlush();

    expect(observations()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "workspace.analyze_argument",
        asType: "tool",
        input: {
          workspaceId: "w1",
          agentRunId: "r1",
          expert: "argument",
          task: "核对论证",
        },
        output: results[0],
      }),
      expect.objectContaining({
        name: "workspace.publish_report",
        asType: "tool",
        input: {
          workspaceId: "w1",
          agentRunId: "r1",
          action: "publish_report",
        },
        output: results[1],
      }),
    ]));
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
