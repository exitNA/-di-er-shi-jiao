// @vitest-environment node

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { ModelRuntime, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { LangfuseOtelSpanAttributes } from "@langfuse/tracing";
import { NodeSDK, tracing } from "@opentelemetry/sdk-node";
import { Type } from "typebox";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const opik = vi.hoisted(() => {
  const spans: Array<{
    end: ReturnType<typeof vi.fn>;
    input: Record<string, unknown>;
    parentName: string;
    span: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  }> = [];
  const traces: Array<{
    end: ReturnType<typeof vi.fn>;
    input: Record<string, unknown>;
    span: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  }> = [];

  const nameOf = (input: Record<string, unknown>): string =>
    typeof input.name === "string" ? input.name : "unknown";
  const createSpan = (input: Record<string, unknown>, parentName: string) => {
    const end = vi.fn();
    const span = vi.fn((childInput: Record<string, unknown>) =>
      createSpan(childInput, nameOf(input))
    );
    const update = vi.fn();
    spans.push({ end, input, parentName, span, update });
    return { end, span, update };
  };
  const client = {
    flush: vi.fn(async () => undefined),
    trace: vi.fn((input: Record<string, unknown>) => {
      const end = vi.fn();
      const span = vi.fn((childInput: Record<string, unknown>) =>
        createSpan(childInput, nameOf(input))
      );
      const update = vi.fn();
      traces.push({ end, input, span, update });
      return { end, span, update };
    }),
  };

  return { client, spans, traces };
});

vi.mock("opik", () => ({
  Opik: vi.fn(function Opik() {
    return opik.client;
  }),
}));

vi.mock("@/server/config/env", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/config/env")>();
  return {
    ...original,
    loadObservabilityEnv: () => ({
      OPIK_PROJECT_NAME: "second-perspective",
      OPIK_URL_OVERRIDE: "http://127.0.0.1:5173/api",
    }),
  };
});

import { moduleTypes, type AnalysisSnapshot } from "@/features/analysis/domain/contracts";
import {
  ManagerAgentRuntime,
  type ManagerAgentContextRepository,
} from "@/server/agents/manager/agent";
import { createExpertHarness } from "@/server/agents/shared/expert-harness";
import {
  createPiSession,
  createProjectPiModelRuntime,
} from "@/server/agents/shared/pi-session";

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
  beforeEach(() => {
    exporter.reset();
    opik.spans.length = 0;
    opik.traces.length = 0;
    vi.clearAllMocks();
  });
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
      const managerGenerations = recorded.filter(({ name, parentSpanId }) =>
        name === "pi.generation" && parentSpanId === manager?.spanId
      );
      const managerGeneration = managerGenerations[0];
      const expertObservation = recorded.find(({ name }) => name === "expert.argument");
      const expertGeneration = recorded.find(({ name, parentSpanId }) =>
        name === "pi.generation" && parentSpanId === expertObservation?.spanId
      );
      const opikManagerGenerations = opik.spans.filter(({ input, parentName }) =>
        input.name === "pi.generation" && parentName === "manager"
      );
      const opikExpertGeneration = opik.spans.find(({ input, parentName }) =>
        input.name === "pi.generation" && parentName === "expert.argument"
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
      expect(managerGenerations).toHaveLength(2);
      expect(managerGenerations[0]?.input).toEqual(expect.objectContaining({
        systemPrompt: expect.any(String),
        messages: [expect.objectContaining({ role: "user" })],
      }));
      expect(managerGenerations[1]?.input).toEqual(expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "assistant" }),
          expect.objectContaining({ role: "toolResult" }),
        ]),
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
          messages: [expect.objectContaining({
            role: "user",
            content: [{ type: "text", text: "完整专家请求" }],
          })],
        },
        output: expect.objectContaining({
          assistant: expect.objectContaining({ stopReason: "toolUse" }),
          toolResults: [expect.objectContaining({ toolName: "complete" })],
        }),
        model: "observed-model",
        usageDetails: expect.objectContaining({ input: 13, output: 8, total: 21 }),
        costDetails: expect.objectContaining({ total: 0.021 }),
      }));
      expect(opikManagerGenerations).toHaveLength(2);
      expect(opikManagerGenerations[1]?.update).toHaveBeenCalledWith(expect.objectContaining({
        input: managerGenerations[1]?.input,
      }));
      expect(opikExpertGeneration?.input).toEqual(expect.objectContaining({
        name: "pi.generation",
        type: "llm",
        input: expect.objectContaining({ systemPrompt: expect.any(String) }),
      }));
      expect(opikExpertGeneration?.update).toHaveBeenCalledWith(expect.objectContaining({
        input: {
          systemPrompt: "完整专家 system prompt",
          messages: [expect.objectContaining({
            role: "user",
            content: [{ type: "text", text: "完整专家请求" }],
          })],
        },
      }));
      expect(opikExpertGeneration?.update).toHaveBeenCalledWith(expect.objectContaining({
        input: expertGeneration?.input,
      }));
      expect(opikExpertGeneration?.update).toHaveBeenCalledWith(expect.objectContaining({
        output: expertGeneration?.output,
      }));
      expect(opikExpertGeneration?.update).toHaveBeenCalledWith(expect.objectContaining({
        output: expect.objectContaining({ assistant: expect.anything() }),
        model: "observed-model",
        usage: {
          prompt_tokens: 13,
          completion_tokens: 8,
          total_tokens: 21,
        },
        totalEstimatedCost: 0.021,
      }));
      expect(opikExpertGeneration?.end).toHaveBeenCalledOnce();
      expect(opik.spans).toContainEqual(expect.objectContaining({
        input: expect.objectContaining({ name: "expert.argument", type: "general" }),
        parentName: "pi.generation",
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
        assistant: expect.objectContaining({ stopReason: "aborted" }),
      }),
    }));
    const opikGeneration = opik.spans.find(({ input }) => input.name === "pi.generation");
    expect(opikGeneration?.update).toHaveBeenCalledWith(expect.objectContaining({
      errorInfo: expect.objectContaining({
        exceptionType: "Cancelled",
        message: "request cancelled",
      }),
      output: expect.objectContaining({
        assistant: expect.objectContaining({ stopReason: "aborted" }),
      }),
    }));
    expect(opikGeneration?.end).toHaveBeenCalledOnce();
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
        assistant: expect.objectContaining({ stopReason: "error" }),
      }),
    }));
    const opikGeneration = opik.spans.find(({ input }) => input.name === "pi.generation");
    expect(opikGeneration?.update).toHaveBeenCalledWith(expect.objectContaining({
      errorInfo: expect.objectContaining({ message: "provider unavailable" }),
      output: expect.objectContaining({
        assistant: expect.objectContaining({ stopReason: "error" }),
      }),
    }));
    expect(opikGeneration?.end).toHaveBeenCalledOnce();
  });

  it("uses production model prices to record a nonzero generation cost", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end([
        `data: ${JSON.stringify({
          id: "chatcmpl-priced",
          object: "chat.completion.chunk",
          created: 1,
          model: "priced-model",
          choices: [{ index: 0, delta: { role: "assistant", content: "priced" }, finish_reason: null }],
        })}\n\n`,
        `data: ${JSON.stringify({
          id: "chatcmpl-priced",
          object: "chat.completion.chunk",
          created: 1,
          model: "priced-model",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        })}\n\n`,
        "data: [DONE]\n\n",
      ].join(""));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected test server address");

    try {
      const { model, modelRuntime } = await createProjectPiModelRuntime({
        apiKey: "test-key",
        baseURL: `http://127.0.0.1:${address.port}/v1`,
        modelId: "priced-model",
        inputUsdPerMillion: 2,
        outputUsdPerMillion: 4,
      });
      const session = await createPiSession({
        systemPrompt: "priced system prompt",
        customTools: [],
        model,
        modelRuntime,
        resourceDir: path.join(process.cwd(), "src/server/agents/manager"),
      });

      await session.prompt("priced request");
      session.dispose();
      await processor.forceFlush();

      expect(model.cost).toEqual(expect.objectContaining({ input: 2, output: 4 }));
      expect(observations()).toContainEqual(expect.objectContaining({
        name: "pi.generation",
        model: "priced-model",
        usageDetails: expect.objectContaining({ input: 10, output: 5, total: 15 }),
        costDetails: expect.objectContaining({ total: expect.any(Number) }),
      }));
      const generation = observations().find(({ model: observedModel }) =>
        observedModel === "priced-model"
      );
      expect((generation?.costDetails as { total?: number })?.total).toBeGreaterThan(0);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) =>
        error ? reject(error) : resolve()
      ));
    }
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
