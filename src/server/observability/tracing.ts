import { loadServerEnv } from "@/server/config/env";

type TracingRuntime = { forceFlush(): Promise<void> };

export async function startLangfuseTracing(
  options: { isolated?: boolean } = {},
): Promise<void> {
  const state = globalThis as typeof globalThis & {
    __secondPerspectiveLangfuseTracing?: Promise<TracingRuntime>;
  };
  state.__secondPerspectiveLangfuseTracing ??= startSdk(options.isolated ?? false);
  await state.__secondPerspectiveLangfuseTracing;
}

export async function flushLangfuseTracing(): Promise<void> {
  const state = globalThis as typeof globalThis & {
    __secondPerspectiveLangfuseTracing?: Promise<TracingRuntime>;
  };
  if (state.__secondPerspectiveLangfuseTracing) {
    await (await state.__secondPerspectiveLangfuseTracing).forceFlush();
  }
}

async function startSdk(isolated: boolean): Promise<TracingRuntime> {
  const env = loadServerEnv();
  const [
    { LangfuseSpanProcessor },
    { setLangfuseTracerProvider },
    { resourceFromAttributes },
    { NodeSDK, tracing },
    { ATTR_SERVICE_NAME },
  ] = await Promise.all([
    import("@langfuse/otel"),
    import("@langfuse/tracing"),
    import("@opentelemetry/resources"),
    import("@opentelemetry/sdk-node"),
    import("@opentelemetry/semantic-conventions"),
  ]);
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "second-perspective",
  });
  const processor = new LangfuseSpanProcessor({
    baseUrl: env.LANGFUSE_BASE_URL,
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    environment: env.LANGFUSE_TRACING_ENVIRONMENT,
  });
  if (isolated) {
    setLangfuseTracerProvider(new tracing.BasicTracerProvider({
      resource,
      spanProcessors: [processor],
    }));
  } else {
    new NodeSDK({ resource, spanProcessors: [processor] }).start();
  }
  return processor;
}
