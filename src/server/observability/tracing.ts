import { loadServerEnv } from "@/server/config/env";

export async function startLangfuseTracing(): Promise<void> {
  const state = globalThis as typeof globalThis & {
    __secondPerspectiveLangfuseTracing?: Promise<void>;
  };
  state.__secondPerspectiveLangfuseTracing ??= startSdk();
  await state.__secondPerspectiveLangfuseTracing;
}

async function startSdk(): Promise<void> {
  const env = loadServerEnv();
  const [
    { LangfuseSpanProcessor },
    { resourceFromAttributes },
    { NodeSDK },
    { ATTR_SERVICE_NAME },
  ] = await Promise.all([
    import("@langfuse/otel"),
    import("@opentelemetry/resources"),
    import("@opentelemetry/sdk-node"),
    import("@opentelemetry/semantic-conventions"),
  ]);
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "second-perspective",
    }),
    spanProcessors: [new LangfuseSpanProcessor({
      baseUrl: env.LANGFUSE_BASE_URL,
      publicKey: env.LANGFUSE_PUBLIC_KEY,
      secretKey: env.LANGFUSE_SECRET_KEY,
      environment: env.LANGFUSE_TRACING_ENVIRONMENT,
    })],
  });
  await sdk.start();
}
