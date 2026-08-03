import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ModelRuntime, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { LangfuseOtelSpanAttributes } from "@langfuse/tracing";
import { NodeSDK, tracing } from "@opentelemetry/sdk-node";
import { Type } from "typebox";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { moduleTypes, type AnalysisSnapshot } from "@/features/analysis/domain/contracts";
import {
  ManagerAgentRuntime,
  type ManagerAgentContextRepository,
} from "@/server/agents/manager/agent";
import { createExpertHarness } from "@/server/agents/shared/expert-harness";
import { createPiSession } from "@/server/agents/shared/pi-session";

const exporter = new tracing.InMemorySpanExporter();
const processor = new LangfuseSpanProcessor({ exporter, exportMode: "immediate" });
const sdk = new NodeSDK({ spanProcessors: [processor] });

type PiMessage = {
  role: "assistant";
  content: Array<Record<string, unknown>>;
  api: "anthropic-messages";
  provider: "anthropic";
  model: string;
  usage: ReturnType<typeof usage>;
  stopReason: "stop" | "toolUse" | "error" | "aborted";
  errorMessage?: string;
  timestamp: number;
};

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

  it("records the production manager, delegate, expert and Pi hierarchy", async () => {
    const resourceRoot = await mkdtemp(path.join(tmpdir(), "pi-observability-"));
    const argumentDir = path.join(resourceRoot, "argument");
    await mkdir(argumentDir);
    let managerTurns = 0;
    const { model, modelRuntime } = await piRuntime((_model, context) => {
      const tools = new Set(context.tools?.map((tool) => tool.name));
      if (tools.has("complete")) {
        return stream(message({
          content: [toolCall("complete-1", "complete", { answer: "完整专家输出" })],
          stopReason: "toolUse",
          tokens: [13, 8],
        }));
      }
      managerTurns += 1;
      return stream(managerTurns === 1
        ? message({
            content: [toolCall("delegate-1", "delegate_expert", { expert: "argument" })],
            stopReason: "toolUse",
            tokens: [11, 7],
          })
        : message({
            content: [{ type: "text", text: "经理已接收专家结果" }],
            stopReason: "stop",
            tokens: [5, 3],
          }));
    });
    const createSession = (input: {
      customTools: ToolDefinition[];
      resourceDir: string;
      systemPrompt: string;
    }) => createPiSession({ ...input, model, modelRuntime });
    const expert = createExpertHarness({
      schema: z.object({ answer: z.string() }),
      completionSchema: Type.Object({ answer: Type.String() }),
      systemPrompt: "完整专家 system prompt",
      resourceDir: argumentDir,
      createSession,
    });
    const runtime = new ManagerAgentRuntime(
      createSession,
      {
        async runExpert(input) {
          if (input.expert !== "argument") return { ok: false as const, code: "UNEXPECTED_EXPERT" };
          await expert.run({ operation: input.expert, prompt: "完整专家请求" });
          return { ok: true as const, summary: "argument completed" };
        },
        async runReportAction() {
          return { ok: false as const, code: "UNEXPECTED_ACTION" };
        },
      },
      managerRepository(),
    );

    try {
      await expect(runtime.run({
        workspaceId: "w1",
        agentRunId: "r1",
        signal: new AbortController().signal,
      })).rejects.toThrow("BASELINE_INCOMPLETE");
      await processor.forceFlush();

      const recorded = observations();
      const analysis = recorded.find(({ name }) => name === "analysis.baseline");
      const manager = recorded.find(({ name }) => name === "manager");
      const managerGeneration = recorded.find(({ name, parentSpanId }) =>
        name === "pi.generation" && parentSpanId === manager?.spanId
      );
      const expertObservation = recorded.find(({ name }) => name === "expert.argument");
      const expertGeneration = recorded.find(({ name, parentSpanId }) =>
        name === "pi.generation" && parentSpanId === expertObservation?.spanId
      );

      expect(manager).toEqual(expect.objectContaining({
        type: "agent",
        traceId: analysis?.traceId,
        parentSpanId: analysis?.spanId,
      }));
      expect(managerGeneration).toEqual(expect.objectContaining({
        type: "generation",
        traceId: analysis?.traceId,
        output: expect.objectContaining({
          toolResults: [expect.objectContaining({ toolName: "delegate_expert" })],
        }),
      }));
      expect(expertObservation).toEqual(expect.objectContaining({
        type: "agent",
        traceId: analysis?.traceId,
        parentSpanId: managerGeneration?.spanId,
      }));
      expect(expertGeneration).toEqual(expect.objectContaining({
        type: "generation",
        traceId: analysis?.traceId,
        input: {
          systemPrompt: "完整专家 system prompt",
          messages: [{ role: "user", content: "完整专家请求" }],
        },
        output: expect.objectContaining({
          toolResults: [expect.objectContaining({ toolName: "complete" })],
        }),
        model: "observed-model",
        usageDetails: expect.objectContaining({ input: 13, output: 8, total: 21 }),
        costDetails: expect.objectContaining({ total: 0.021 }),
      }));
    } finally {
      await rm(resourceRoot, { force: true, recursive: true });
    }
  });

  it("records cancellation produced by session.abort", async () => {
    let streamStarted = () => {};
    const started = new Promise<void>((resolve) => { streamStarted = resolve; });
    const cancelledMessage = message({
      content: [{ type: "text", text: "已取消前的部分输出" }],
      stopReason: "aborted",
      errorMessage: "request cancelled",
      tokens: [5, 2],
    });
    const { model, modelRuntime } = await piRuntime((_model, _context, options) => {
      const signal = options?.signal;
      streamStarted();
      return {
        async *[Symbol.asyncIterator]() {
          if (!signal?.aborted) {
            await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
          }
          yield { type: "error" as const, reason: "aborted" as const, error: cancelledMessage };
        },
        result: async () => cancelledMessage,
      } as unknown as ReturnType<ModelRuntime["streamSimple"]>;
    });
    const session = await createPiSession({
      systemPrompt: "cancel system prompt",
      customTools: [],
      model,
      modelRuntime,
      resourceDir: path.join(process.cwd(), "src/server/agents/manager"),
    });

    const prompting = session.prompt("取消请求");
    await started;
    await session.abort();
    await prompting;
    session.dispose();
    await processor.forceFlush();

    expect(observations()).toContainEqual(expect.objectContaining({
      name: "pi.generation",
      level: "WARNING",
      statusMessage: "request cancelled",
      output: expect.objectContaining({
        assistant: [expect.objectContaining({ stopReason: "aborted" })],
      }),
    }));
  });

  it("records provider errors when Pi does not retry", async () => {
    const providerError = message({
      content: [{ type: "text", text: "provider partial output" }],
      stopReason: "error",
      errorMessage: "provider unavailable",
      tokens: [4, 1],
    });
    const { model, modelRuntime } = await piRuntime(() => stream(providerError));
    const session = await createPiSession({
      systemPrompt: "error system prompt",
      customTools: [],
      model,
      modelRuntime,
      resourceDir: path.join(process.cwd(), "src/server/agents/manager"),
    });
    session.setAutoRetryEnabled(false);

    await session.prompt("错误请求");
    session.dispose();
    await processor.forceFlush();

    expect(observations()).toContainEqual(expect.objectContaining({
      name: "pi.generation",
      level: "ERROR",
      statusMessage: "provider unavailable",
      output: expect.objectContaining({
        assistant: [expect.objectContaining({ stopReason: "error" })],
      }),
    }));
  });
});

async function piRuntime(streamSimple: ModelRuntime["streamSimple"]) {
  const modelRuntime = await ModelRuntime.create({ modelsPath: null });
  const model = modelRuntime.getModels("anthropic")[0];
  if (!model) throw new Error("Expected the Anthropic model catalog to be available");
  vi.spyOn(modelRuntime, "getAvailable").mockResolvedValue([model]);
  vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
  vi.spyOn(modelRuntime, "streamSimple").mockImplementation(streamSimple);
  return { model, modelRuntime };
}

function message(input: {
  content: Array<Record<string, unknown>>;
  stopReason: PiMessage["stopReason"];
  tokens: [input: number, output: number];
  errorMessage?: string;
}): PiMessage {
  return {
    role: "assistant",
    content: input.content,
    api: "anthropic-messages",
    provider: "anthropic",
    model: "observed-model",
    usage: usage(...input.tokens),
    stopReason: input.stopReason,
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
    timestamp: Date.now(),
  };
}

function usage(input: number, output: number) {
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + output,
    cost: { input: input / 1_000, output: output / 1_000, cacheRead: 0, cacheWrite: 0, total: (input + output) / 1_000 },
  };
}

function toolCall(id: string, name: string, argumentsValue: Record<string, unknown>) {
  return { type: "toolCall", id, name, arguments: argumentsValue };
}

function stream(value: PiMessage): ReturnType<ModelRuntime["streamSimple"]> {
  return {
    async *[Symbol.asyncIterator]() {
      if (value.stopReason === "error" || value.stopReason === "aborted") {
        yield { type: "error", reason: value.stopReason, error: value };
      } else {
        yield { type: "done", reason: value.stopReason, message: value };
      }
    },
    result: async () => value,
  } as unknown as ReturnType<ModelRuntime["streamSimple"]>;
}

function managerRepository(): ManagerAgentContextRepository {
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
    modules: Object.fromEntries(moduleTypes.map((moduleType) => [
      moduleType,
      { status: "queued", version: 0 },
    ])) as AnalysisSnapshot["modules"],
  };
  return {
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
    async getOwnedSnapshot() {
      return snapshot;
    },
    async listCompletedWorkspaceToolNames() {
      return [];
    },
    async listPersistedAgentToolArtifacts() {
      return [];
    },
    async appendEvent() {
      return 1;
    },
  };
}
