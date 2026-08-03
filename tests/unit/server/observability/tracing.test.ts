import { getLangfuseTracerProvider } from "@langfuse/tracing";
import { trace } from "@opentelemetry/api";
import { afterEach, expect, it, vi } from "vitest";

import {
  flushLangfuseTracing,
  startLangfuseTracing,
} from "@/server/observability/tracing";

afterEach(() => vi.unstubAllEnvs());

it("uses a non-global provider for local-only Trigger observations", async () => {
  vi.stubEnv("APP_URL", "http://127.0.0.1:5000");
  vi.stubEnv("DATABASE_URL", "postgres://app:app@127.0.0.1:54329/test");
  vi.stubEnv("AUTH_SECRET", "test-auth-secret-that-is-at-least-32-bytes");
  vi.stubEnv("LLM_BASE_URL", "http://127.0.0.1:4000/v1");
  vi.stubEnv("LLM_API_KEY", "test-key");
  vi.stubEnv("LLM_MODEL_ID", "test-model");
  vi.stubEnv("LANGFUSE_BASE_URL", "http://127.0.0.1:3000");
  vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-lf-test");
  vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-lf-test");

  await startLangfuseTracing({ isolated: true });

  expect(getLangfuseTracerProvider()).not.toBe(trace.getTracerProvider());
  await expect(flushLangfuseTracing()).resolves.toBeUndefined();
});
