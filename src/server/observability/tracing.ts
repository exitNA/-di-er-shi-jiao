import {
  SpanStatusCode,
  trace,
  type Attributes,
} from "@opentelemetry/api";

const tracer = trace.getTracer("second-perspective");

export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number>,
  run: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    span.setAttributes(attributes as Attributes);
    try {
      return await run();
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

export async function startTelemetry(): Promise<void> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return;

  const state = globalThis as typeof globalThis & {
    __secondPerspectiveTelemetry?: Promise<void>;
  };
  state.__secondPerspectiveTelemetry ??= startSdk(endpoint);
  await state.__secondPerspectiveTelemetry;
}

async function startSdk(endpoint: string): Promise<void> {
  const [
    { OTLPTraceExporter },
    { resourceFromAttributes },
    { NodeSDK },
    { ATTR_SERVICE_NAME },
  ] = await Promise.all([
    import("@opentelemetry/exporter-trace-otlp-http"),
    import("@opentelemetry/resources"),
    import("@opentelemetry/sdk-node"),
    import("@opentelemetry/semantic-conventions"),
  ]);
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "second-perspective",
    }),
    traceExporter: new OTLPTraceExporter({ url: endpoint }),
  });
  await sdk.start();
}
