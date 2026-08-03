import { LangfuseSpanProcessor } from "@langfuse/otel";
import { LangfuseOtelSpanAttributes } from "@langfuse/tracing";
import { NodeSDK, tracing } from "@opentelemetry/sdk-node";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  withAnalysisTrace,
  withLangfuseObservation,
} from "@/server/observability/langfuse";

const exporter = new tracing.InMemorySpanExporter();
const processor = new LangfuseSpanProcessor({
  exporter,
  exportMode: "immediate",
});
const sdk = new NodeSDK({ spanProcessors: [processor] });
const run = promisify(execFile);

function parseAttribute(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function recorded() {
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
    level: span.attributes[LangfuseOtelSpanAttributes.OBSERVATION_LEVEL],
    statusMessage:
      span.attributes[LangfuseOtelSpanAttributes.OBSERVATION_STATUS_MESSAGE],
    traceName: span.attributes[LangfuseOtelSpanAttributes.TRACE_NAME],
    userId: span.attributes[LangfuseOtelSpanAttributes.TRACE_USER_ID],
    sessionId: span.attributes[LangfuseOtelSpanAttributes.TRACE_SESSION_ID],
    traceMetadata: {
      kind: span.attributes[`${LangfuseOtelSpanAttributes.TRACE_METADATA}.kind`],
      workspaceId:
        span.attributes[`${LangfuseOtelSpanAttributes.TRACE_METADATA}.workspaceId`],
    },
  }));
}

describe("Langfuse observations", () => {
  beforeAll(() => sdk.start());
  beforeEach(() => exporter.reset());
  afterAll(() => sdk.shutdown());

  it("propagates a detailed analysis trace to a nested generation", async () => {
    await withAnalysisTrace(
      {
        workspaceId: "w1",
        userId: "u1",
        kind: "baseline",
        material: "原始材料",
      },
      async () => {
        await withLangfuseObservation(
          {
            name: "expert.argument",
            asType: "generation",
            input: { prompt: "完整提示词" },
            metadata: { expertId: "argument" },
          },
          async (observation) => {
            observation.update({
              output: "完整输出",
              model: "test-model",
              usageDetails: { input: 2, output: 1 },
            });
          },
        );
      },
    );
    await processor.forceFlush();

    const observations = recorded();
    const analysis = observations.find(({ name }) => name === "analysis.baseline");
    const generation = observations.find(({ name }) => name === "expert.argument");

    expect(analysis).toEqual(expect.objectContaining({
      input: { material: "原始材料" },
      traceName: "analysis.baseline",
      userId: "u1",
      sessionId: "w1",
      traceMetadata: { kind: "baseline", workspaceId: "w1" },
    }));
    expect(generation).toEqual(expect.objectContaining({
      type: "generation",
      input: { prompt: "完整提示词" },
      output: "完整输出",
      model: "test-model",
      usageDetails: { input: 2, output: 1 },
      traceId: analysis?.traceId,
      parentSpanId: analysis?.spanId,
    }));
  });

  it("records and rethrows observation errors", async () => {
    const failure = new Error("provider failed");

    await expect(withLangfuseObservation(
      {
        name: "expert.failed",
        asType: "generation",
        input: { prompt: "完整提示词" },
      },
      async () => {
        throw failure;
      },
    )).rejects.toBe(failure);
    await processor.forceFlush();

    expect(recorded()).toContainEqual(expect.objectContaining({
      name: "expert.failed",
      level: "ERROR",
      statusMessage: "provider failed",
    }));
  });
});

it("does not retain a legacy OTLP observability configuration", async () => {
  await expect(run("git", [
    "grep",
    "-n",
    "-E",
    "OTEL_EXPORTER_OTLP_ENDPOINT|OTLPTraceExporter|exporter-trace-otlp-http",
    "--",
    ".",
    ":(exclude)pnpm-lock.yaml",
    ":(exclude)docs/superpowers/**",
    ":(exclude).superpowers/**",
    ":(exclude)tests/unit/server/observability/langfuse.test.ts",
  ])).rejects.toMatchObject({ code: 1 });
});
