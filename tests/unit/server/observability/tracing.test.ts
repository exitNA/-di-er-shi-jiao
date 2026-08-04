import { getLangfuseTracerProvider } from "@langfuse/tracing";
import { trace } from "@opentelemetry/api";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  flushObservationClient: vi.fn(async () => undefined),
}));

vi.mock("@/server/observability/observations", () => ({
  flushObservationClient: mocks.flushObservationClient,
}));

import {
  flushObservability,
  startObservability,
} from "@/server/observability/tracing";

beforeEach(() => {
  delete (globalThis as typeof globalThis & {
    __secondPerspectiveObservability?: Promise<unknown>;
  }).__secondPerspectiveObservability;
});

afterEach(() => vi.unstubAllEnvs());

it.each(["OPIK_URL_OVERRIDE", "OPIK_PROJECT_NAME"] as const)(
  "requires %s before starting observability",
  async (missingKey) => {
    vi.stubEnv("APP_URL", "http://127.0.0.1:5000");
    vi.stubEnv("DATABASE_URL", "postgres://app:app@127.0.0.1:54329/test");
    vi.stubEnv("AUTH_SECRET", "test-auth-secret-that-is-at-least-32-bytes");
    vi.stubEnv("LLM_BASE_URL", "http://127.0.0.1:4000/v1");
    vi.stubEnv("LLM_API_KEY", "test-key");
    vi.stubEnv("LLM_MODEL_ID", "test-model");
    vi.stubEnv("LANGFUSE_BASE_URL", "http://127.0.0.1:3000");
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-lf-test");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-lf-test");
    vi.stubEnv("OPIK_URL_OVERRIDE", "http://127.0.0.1:5173/api");
    vi.stubEnv("OPIK_PROJECT_NAME", "second-perspective");
    vi.stubEnv(missingKey, undefined);

    await expect(startObservability({ isolated: true })).rejects.toThrow(missingKey);
  },
);

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
  vi.stubEnv("OPIK_URL_OVERRIDE", "http://127.0.0.1:5173/api");
  vi.stubEnv("OPIK_PROJECT_NAME", "second-perspective");

  await startObservability({ isolated: true });

  expect(getLangfuseTracerProvider()).not.toBe(trace.getTracerProvider());
  await expect(flushObservability()).resolves.toBeUndefined();
  expect(mocks.flushObservationClient).toHaveBeenCalledOnce();
});
