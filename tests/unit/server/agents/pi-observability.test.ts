import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { LangfuseSpanProcessor } from "@langfuse/otel";
import { LangfuseOtelSpanAttributes } from "@langfuse/tracing";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { NodeSDK, tracing } from "@opentelemetry/sdk-node";
import { Type } from "typebox";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createExpertHarness } from "@/server/agents/shared/expert-harness";
import { createPiSession } from "@/server/agents/shared/pi-session";
import {
  withAnalysisTrace,
  withLangfuseObservation,
} from "@/server/observability/langfuse";

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
    parentSpanId: span.parentSpanContext?.spanId,
    spanId: span.spanContext().spanId,
    type: span.attributes[LangfuseOtelSpanAttributes.OBSERVATION_TYPE],
    input: parseAttribute(span.attributes[LangfuseOtelSpanAttributes.OBSERVATION_INPUT]),
    output: parseAttribute(span.attributes[LangfuseOtelSpanAttributes.OBSERVATION_OUTPUT]),
    model: span.attributes[LangfuseOtelSpanAttributes.OBSERVATION_MODEL],
    usageDetails: parseAttribute(
      span.attributes[LangfuseOtelSpanAttributes.OBSERVATION_USAGE_DETAILS],
    ),
    costDetails: parseAttribute(
      span.attributes[LangfuseOtelSpanAttributes.OBSERVATION_COST_DETAILS],
    ),
    level: span.attributes[LangfuseOtelSpanAttributes.OBSERVATION_LEVEL],
    statusMessage: span.attributes[LangfuseOtelSpanAttributes.OBSERVATION_STATUS_MESSAGE],
  }));
}

describe("Pi observability", () => {
  beforeAll(() => sdk.start());
  beforeEach(() => exporter.reset());
  afterAll(() => sdk.shutdown());

  it("records manager, expert and model generation as one detailed trace", async () => {
    const resourceDir = await mkdtemp(path.join(tmpdir(), "pi-observability-"));
    const modelRuntime = await ModelRuntime.create({ modelsPath: null });
    const model = modelRuntime.getModels("anthropic")[0];
    if (!model) throw new Error("Expected the Anthropic model catalog to be available");
    vi.spyOn(modelRuntime, "getAvailable").mockResolvedValue([model]);
    vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
    let generation = 0;
    vi.spyOn(modelRuntime, "streamSimple").mockImplementation(() => {
      generation += 1;
      const message = generation === 1 ? {
        role: "assistant" as const,
        content: [{
          type: "toolCall" as const,
          id: "complete-1",
          name: "complete",
          arguments: { answer: "完整输出" },
        }],
        api: "anthropic-messages" as const,
        provider: "anthropic" as const,
        model: "observed-model",
        usage: {
          input: 11,
          output: 7,
          cacheRead: 3,
          cacheWrite: 2,
          totalTokens: 23,
          cost: { input: 0.01, output: 0.02, cacheRead: 0.003, cacheWrite: 0.002, total: 0.035 },
        },
        stopReason: "toolUse" as const,
        timestamp: Date.now(),
      } : {
        role: "assistant" as const,
        content: [{ type: "text" as const, text: "已取消前的部分输出" }],
        api: "anthropic-messages" as const,
        provider: "anthropic" as const,
        model: "observed-model",
        usage: {
          input: 5,
          output: 2,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 7,
          cost: { input: 0.005, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.007 },
        },
        stopReason: "aborted" as const,
        errorMessage: "request cancelled",
        timestamp: Date.now(),
      };
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: "done" as const, reason: "toolUse" as const, message };
        },
        result: async () => message,
      } as unknown as ReturnType<ModelRuntime["streamSimple"]>;
    });
    const harness = createExpertHarness({
      schema: z.object({ answer: z.string() }),
      completionSchema: Type.Object({ answer: Type.String() }),
      systemPrompt: "完整 system prompt",
      resourceDir,
      createSession: (input) => createPiSession({ ...input, model, modelRuntime }),
    });

    try {
      await withAnalysisTrace(
        { workspaceId: "w1", userId: "u1", kind: "baseline", material: "原始材料" },
        () => withLangfuseObservation(
          { name: "manager", asType: "agent", input: { agentRunId: "r1" } },
          async () => {
            const result = await harness.run({ operation: "argument", prompt: "完整请求文本" });
            const cancelled = await createPiSession({
              systemPrompt: "完整 system prompt",
              customTools: [],
              model,
              modelRuntime,
              resourceDir,
            });
            await cancelled.prompt("取消请求");
            cancelled.dispose();
            return result;
          },
        ),
      );
      await processor.forceFlush();

      const recorded = observations();
      const analysis = recorded.find(({ name }) => name === "analysis.baseline");
      const manager = recorded.find(({ name }) => name === "manager");
      const expert = recorded.find(({ name }) => name === "expert.argument");
      const generation = recorded.find(({ name }) => name === "pi.generation");
      const cancelled = recorded.find(({ statusMessage }) => statusMessage === "request cancelled");
      expect(manager).toEqual(expect.objectContaining({
        type: "agent",
        traceId: analysis?.traceId,
        parentSpanId: analysis?.spanId,
      }));
      expect(expert).toEqual(expect.objectContaining({
        type: "agent",
        traceId: analysis?.traceId,
        parentSpanId: manager?.spanId,
      }));
      expect(generation).toEqual(expect.objectContaining({
        type: "generation",
        traceId: analysis?.traceId,
        parentSpanId: expert?.spanId,
        input: {
          systemPrompt: "完整 system prompt",
          messages: [{ role: "user", content: "完整请求文本" }],
        },
        output: expect.objectContaining({
          assistant: expect.any(Array),
          toolResults: [expect.objectContaining({ toolName: "complete" })],
        }),
        model: "observed-model",
        usageDetails: expect.objectContaining({ input: 11, output: 7, total: 23 }),
        costDetails: expect.objectContaining({ total: 0.035 }),
      }));
      expect(cancelled).toEqual(expect.objectContaining({
        name: "pi.generation",
        level: "WARNING",
        output: expect.objectContaining({
          assistant: [expect.objectContaining({ stopReason: "aborted" })],
        }),
      }));
    } finally {
      await rm(resourceDir, { force: true, recursive: true });
    }
  });
});
