import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@trigger.dev/sdk", () => ({
  tasks: { trigger: vi.fn() },
}));

const baseEnv = {
  NODE_ENV: "test",
  APP_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgres://app:app@127.0.0.1:54329/second_perspective",
  AUTH_SECRET: "test-auth-secret-that-is-at-least-32-bytes",
} as const;

describe("getContainer", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates one fake in-process container without external keys", async () => {
    stubEnv({ AGENT_ADAPTER: "fake", ANALYSIS_RUNTIME: "in-process" });
    const { getContainer } = await import("@/server/container");
    const { InProcessAnalysisDispatcher } = await import(
      "@/server/adapters/tasks/in-process-analysis-dispatcher"
    );

    const first = getContainer();

    expect(first).toBe(getContainer());
    expect(first.analysisDispatcher).toBeInstanceOf(
      InProcessAnalysisDispatcher,
    );
    expect(first.baselineOrchestrator).toBeDefined();
  });

  it("rejects a real agent without LLM and Tavily settings", async () => {
    stubEnv({
      AGENT_ADAPTER: "openai-compatible",
      ANALYSIS_RUNTIME: "in-process",
    });
    const { getContainer } = await import("@/server/container");

    expect(() => getContainer()).toThrow(/LLM_BASE_URL/);
    expect(() => getContainer()).toThrow(/TAVILY_API_KEY/);
  });

  it("rejects Trigger runtime without Trigger settings", async () => {
    stubEnv({ AGENT_ADAPTER: "fake", ANALYSIS_RUNTIME: "trigger" });
    const { getContainer } = await import("@/server/container");

    expect(() => getContainer()).toThrow(/TRIGGER_SECRET_KEY/);
    expect(() => getContainer()).toThrow(/TRIGGER_PROJECT_REF/);
  });
});

function stubEnv(overrides: Record<string, string>): void {
  vi.resetModules();
  for (const [key, value] of Object.entries(baseEnv)) vi.stubEnv(key, value);
  for (const key of [
    "LLM_BASE_URL",
    "LLM_API_KEY",
    "LLM_MODEL_ID",
    "TAVILY_API_KEY",
    "TRIGGER_SECRET_KEY",
    "TRIGGER_PROJECT_REF",
  ]) {
    vi.stubEnv(key, undefined);
  }
  for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
}
