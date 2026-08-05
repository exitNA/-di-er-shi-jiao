import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@trigger.dev/sdk", () => ({
  tasks: { trigger: vi.fn() },
}));

const baseEnv = {
  NODE_ENV: "test",
  APP_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgres://app:app@127.0.0.1:54329/second_perspective",
  AUTH_SECRET: "test-auth-secret-that-is-at-least-32-bytes",
  LLM_BASE_URL: "https://llm.example/v1",
  LLM_API_KEY: "test-key",
  LLM_MODEL_ID: "test-model",
  TAVILY_API_KEY: "test-tavily-key",
  LANGFUSE_BASE_URL: "http://localhost:3000",
  LANGFUSE_PUBLIC_KEY: "pk-lf-test",
  LANGFUSE_SECRET_KEY: "sk-lf-test",
} as const;
const realServiceKeys = [
  "LLM_BASE_URL",
  "LLM_API_KEY",
  "LLM_MODEL_ID",
] as const;

describe("getContainer", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it(
    "creates one real in-process container",
    async () => {
      stubEnv({ ANALYSIS_RUNTIME: "in-process" });
      const { getContainer } = await import("@/server/container");
      const { InProcessAnalysisDispatcher } = await import(
        "@/server/adapters/tasks/in-process-analysis-dispatcher"
      );
      const { ManagerAgentRuntime } = await import(
        "@/server/agents/manager/agent"
      );

      const first = getContainer();

      expect(first).toBe(getContainer());
      expect(first.analysisDispatcher).toBeInstanceOf(
        InProcessAnalysisDispatcher,
      );
      expect(first.workspaceAgentRuntime).toBeInstanceOf(
        ManagerAgentRuntime,
      );
    },
    30_000,
  );

  it.each(realServiceKeys)(
    "requires %s for the real agent in development",
    async (key) => {
      stubEnv({
        NODE_ENV: "development",
        ANALYSIS_RUNTIME: "in-process",
        [key]: undefined,
      });
      const { getContainer } = await import("@/server/container");

      expect(() => getContainer()).toThrow(new RegExp(key));
    },
    30_000,
  );

  it("rejects Trigger runtime without Trigger settings", async () => {
    stubEnv({ ANALYSIS_RUNTIME: "trigger" });
    const { getContainer } = await import("@/server/container");

    expect(() => getContainer()).toThrow(/TRIGGER_SECRET_KEY/);
    expect(() => getContainer()).toThrow(/TRIGGER_PROJECT_REF/);
  });

  it("creates the real Agent container without online search", async () => {
    stubEnv({ ANALYSIS_RUNTIME: "in-process", TAVILY_API_KEY: undefined });
    const { getContainer } = await import("@/server/container");

    expect(() => getContainer()).not.toThrow();
  }, 30_000);
});

function stubEnv(overrides: Record<string, string | undefined>): void {
  vi.resetModules();
  for (const [key, value] of Object.entries(baseEnv)) vi.stubEnv(key, value);
  for (const key of ["TRIGGER_SECRET_KEY", "TRIGGER_PROJECT_REF"]) {
    vi.stubEnv(key, undefined);
  }
  for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
}
