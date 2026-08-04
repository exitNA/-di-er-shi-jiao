import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  LangfuseOtelSpanAttributes,
} from "@langfuse/tracing";
import { context, trace as otelTrace } from "@opentelemetry/api";
import { NodeSDK, tracing } from "@opentelemetry/sdk-node";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const opik = vi.hoisted(() => {
  const childSpan = {
    end: vi.fn(),
    span: vi.fn(),
    update: vi.fn(),
  };
  const span = {
    end: vi.fn(),
    span: vi.fn(() => childSpan),
    update: vi.fn(),
  };
  const trace = {
    end: vi.fn(),
    span: vi.fn(() => span),
    update: vi.fn(),
  };
  return {
    client: {
      flush: vi.fn(async () => undefined),
      trace: vi.fn(() => trace),
    },
    childSpan,
    span,
    trace,
  };
});

vi.mock("opik", () => ({
  Opik: vi.fn(function Opik() {
    return opik.client;
  }),
}));

vi.mock("@/server/config/env", () => ({
  loadObservabilityEnv: () => ({
    OPIK_PROJECT_NAME: "second-perspective",
    OPIK_URL_OVERRIDE: "http://127.0.0.1:5173/api",
  }),
}));

import {
  startObservation,
  withAnalysisTrace,
  withObservation,
} from "@/server/observability/observations";

const exporter = new tracing.InMemorySpanExporter();
const processor = new LangfuseSpanProcessor({ exporter, exportMode: "immediate" });
const sdk = new NodeSDK({ spanProcessors: [processor] });
const read = (file: string) => readFile(join(process.cwd(), file), "utf8");
const traceInput = {
  workspaceId: "w1",
  userId: "u1",
  kind: "baseline" as const,
  material: "原始材料",
};

function parseAttribute(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function langfuseObservations() {
  return exporter.getFinishedSpans().map((span) => ({
    name: span.name,
    traceId: span.spanContext().traceId,
    parentSpanId: span.parentSpanContext?.spanId,
    spanId: span.spanContext().spanId,
    type: span.attributes[LangfuseOtelSpanAttributes.OBSERVATION_TYPE],
    input: parseAttribute(span.attributes[LangfuseOtelSpanAttributes.OBSERVATION_INPUT]),
    output: parseAttribute(span.attributes[LangfuseOtelSpanAttributes.OBSERVATION_OUTPUT]),
    metadata: {
      expertId: span.attributes[
        `${LangfuseOtelSpanAttributes.OBSERVATION_METADATA}.expertId`
      ],
    },
    model: span.attributes[LangfuseOtelSpanAttributes.OBSERVATION_MODEL],
    usageDetails: parseAttribute(
      span.attributes[LangfuseOtelSpanAttributes.OBSERVATION_USAGE_DETAILS],
    ),
    level: span.attributes[LangfuseOtelSpanAttributes.OBSERVATION_LEVEL],
    statusMessage: span.attributes[LangfuseOtelSpanAttributes.OBSERVATION_STATUS_MESSAGE],
  }));
}

describe("dual observations", () => {
  beforeAll(() => sdk.start());
  beforeEach(() => exporter.reset());
  afterAll(() => sdk.shutdown());

  it("writes the same generation details to Langfuse and Opik", async () => {
    await withAnalysisTrace(traceInput, () => withObservation(
      {
        name: "expert.argument",
        asType: "generation",
        input: { prompt: "完整提示词" },
        metadata: { expertId: "argument" },
      },
      async (observation) => observation.update({
        output: "完整输出",
        model: "test-model",
        usageDetails: { input: 2, output: 1 },
      }),
    ));
    await processor.forceFlush();

    expect(opik.client.trace).toHaveBeenCalledWith(expect.objectContaining({
      name: "analysis.baseline",
      input: { material: "原始材料" },
      metadata: expect.objectContaining({ kind: "baseline", workspaceId: "w1" }),
    }));
    expect(opik.trace.span).toHaveBeenCalledWith(expect.objectContaining({
      name: "expert.argument",
      type: "llm",
      input: { prompt: "完整提示词" },
      metadata: { expertId: "argument" },
    }));
    expect(opik.span.update).toHaveBeenCalledWith(expect.objectContaining({
      output: "完整输出",
      model: "test-model",
      usage: { prompt_tokens: 2, completion_tokens: 1 },
    }));
    expect(opik.span.end).toHaveBeenCalledOnce();
    expect(opik.trace.end).toHaveBeenCalledOnce();
    const observations = langfuseObservations();
    const analysis = observations.find(({ name }) => name === "analysis.baseline");
    expect(observations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "analysis.baseline",
        input: { material: "原始材料" },
      }),
      expect.objectContaining({
        name: "expert.argument",
        type: "generation",
        input: { prompt: "完整提示词" },
        output: "完整输出",
        metadata: { expertId: "argument" },
        model: "test-model",
        usageDetails: { input: 2, output: 1 },
        traceId: analysis?.traceId,
        parentSpanId: analysis?.spanId,
      }),
    ]));
    expect(exporter.getFinishedSpans()).toHaveLength(2);
  });

  it("ends both observations with the same error and rethrows it", async () => {
    const failure = new Error("provider failed");

    await expect(withAnalysisTrace(traceInput, () => withObservation(
      {
        name: "expert.failed",
        asType: "generation",
        input: { prompt: "完整提示词" },
      },
      async () => {
        throw failure;
      },
    ))).rejects.toBe(failure);
    await processor.forceFlush();

    expect(opik.span.update).toHaveBeenCalledWith(expect.objectContaining({
      errorInfo: expect.objectContaining({ message: "provider failed" }),
      output: { error: "provider failed" },
    }));
    expect(opik.span.end).toHaveBeenCalledOnce();
    expect(langfuseObservations()).toContainEqual(expect.objectContaining({
      name: "expert.failed",
      level: "ERROR",
      statusMessage: "provider failed",
    }));
  });

  it("uses a returned value as output when the handle did not set one", async () => {
    await withAnalysisTrace(traceInput, () => withObservation(
      { name: "sources.search", asType: "retriever", input: { query: "证据" } },
      async () => ({ candidates: ["source-1"] }),
    ));
    await processor.forceFlush();

    expect(opik.span.update).toHaveBeenCalledWith(expect.objectContaining({
      output: { candidates: ["source-1"] },
    }));
    expect(langfuseObservations()).toContainEqual(expect.objectContaining({
      name: "sources.search",
      output: { candidates: ["source-1"] },
    }));
  });

  it("maps warning cancellations to Opik without replacing the output", async () => {
    await withAnalysisTrace(traceInput, () => withObservation(
      { name: "pi.generation", asType: "generation", input: { prompt: "完整提示词" } },
      async (observation) => observation.update({
        level: "WARNING",
        statusMessage: "request cancelled",
        output: { assistant: "partial output" },
      }),
    ));

    expect(opik.span.update).toHaveBeenCalledWith(expect.objectContaining({
      errorInfo: {
        exceptionType: "Cancelled",
        message: "request cancelled",
        traceback: "request cancelled",
      },
      output: { assistant: "partial output" },
    }));
  });

  it("keeps an explicit observation active as the Opik parent", async () => {
    await withAnalysisTrace(traceInput, async () => {
      const generation = startObservation({
        name: "pi.generation",
        asType: "generation",
        input: { prompt: "完整提示词" },
      });
      generation.update({ output: "完整输出", model: "test-model" });

      await context.with(
        otelTrace.setSpan(context.active(), generation.otelSpan),
        () => withObservation(
          { name: "workspace.search", asType: "tool", input: { query: "证据" } },
          async () => "found",
        ),
      );
      generation.end();
    });
    await processor.forceFlush();

    expect(opik.span.span).toHaveBeenCalledWith(expect.objectContaining({
      name: "workspace.search",
      type: "tool",
    }));
    expect(opik.childSpan.end).toHaveBeenCalledOnce();
    expect(langfuseObservations()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "pi.generation", output: "完整输出" }),
      expect.objectContaining({ name: "workspace.search", output: "found" }),
    ]));
  });

  it("ends an explicit observation with an error once", async () => {
    const failure = new Error("provider failed");

    await withAnalysisTrace(traceInput, async () => {
      const generation = startObservation({
        name: "pi.failed",
        asType: "generation",
        input: { prompt: "完整提示词" },
      });
      generation.end(failure);
      generation.end();
    });
    await processor.forceFlush();

    expect(opik.span.update).toHaveBeenCalledWith(expect.objectContaining({
      errorInfo: expect.objectContaining({ message: "provider failed" }),
      output: { error: "provider failed" },
    }));
    expect(opik.span.end).toHaveBeenCalledOnce();
    expect(langfuseObservations()).toContainEqual(expect.objectContaining({
      name: "pi.failed",
      level: "ERROR",
      statusMessage: "provider failed",
    }));
  });

  it.each([
    ["agent", "general"],
    ["chain", "general"],
    ["retriever", "general"],
    ["tool", "tool"],
  ] as const)("maps %s observations to Opik %s spans", async (asType, type) => {
    await withAnalysisTrace(traceInput, () => withObservation(
      { name: `mapped.${asType}`, asType, input: {} },
      async () => undefined,
    ));

    expect(opik.trace.span).toHaveBeenCalledWith(expect.objectContaining({ type }));
  });
});

it("does not retain a legacy OTLP observability configuration", async () => {
  const [packageJson, ...runtime] = await Promise.all([
    read("package.json"),
    read(".env.example"),
    read("README.md"),
    read("docs/operations/mvp-baseline.md"),
    read("src/instrumentation.ts"),
    read("src/server.ts"),
    read("src/server/config/env.ts"),
    read("src/server/observability/observations.ts"),
    read("src/server/observability/tracing.ts"),
  ]);
  const runtimeText = runtime.join("\n");

  expect(JSON.parse(packageJson).dependencies).not.toHaveProperty(
    "@opentelemetry/exporter-trace-otlp-http",
  );
  expect(runtimeText).not.toContain("OTEL_EXPORTER_OTLP_ENDPOINT");
  expect(runtimeText).not.toContain("OTLPTraceExporter");
});
