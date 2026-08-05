import { describe, expect, it } from "vitest";
import { loadServerEnv, reasoningEffortForAgent } from "@/server/config/env";

const baseEnv = {
  NODE_ENV: "production",
  APP_URL: "https://second-perspective.example.com",
  DATABASE_URL: "postgres://app:app@database/second_perspective",
  AUTH_SECRET: "production-auth-secret-that-is-at-least-32-bytes",
  ANALYSIS_RUNTIME: "in-process",
};
const realAgentEnv = {
  LLM_BASE_URL: "https://llm.example/v1",
  LLM_API_KEY: "test-key",
  LLM_MODEL_ID: "test-model",
  TAVILY_API_KEY: "test-tavily-key",
} as const;
const langfuseEnv = {
  LANGFUSE_BASE_URL: "http://localhost:3000",
  LANGFUSE_PUBLIC_KEY: "pk-lf-test",
  LANGFUSE_SECRET_KEY: "sk-lf-test",
} as const;

describe("loadServerEnv", () => {
  it("requires the real Agent configuration in every environment", () => {
    expect(() => loadServerEnv({
      ...baseEnv,
    })).toThrow(/LLM_BASE_URL/);
  });

  it("accepts a complete real Agent configuration", () => {
    expect(loadServerEnv({
      ...baseEnv,
      ...realAgentEnv,
      ...langfuseEnv,
    }).LLM_MODEL_ID).toBe("test-model");
  });

  it("accepts the configured LLM reasoning effort", () => {
    expect(loadServerEnv({
      ...baseEnv,
      ...realAgentEnv,
      ...langfuseEnv,
      LLM_REASONING_EFFORT: "high",
    }).LLM_REASONING_EFFORT).toBe("high");
  });

  it("lets an Agent override the default reasoning effort", () => {
    const env = loadServerEnv({
      ...baseEnv,
      ...realAgentEnv,
      ...langfuseEnv,
      LLM_REASONING_EFFORT: "low",
      LLM_REASONING_EFFORT_MANAGER: "high",
    });

    expect(reasoningEffortForAgent(env, "manager")).toBe("high");
    expect(reasoningEffortForAgent(env, "sources")).toBe("low");
  });

  it("accepts max when the provider supports it", () => {
    expect(loadServerEnv({
      ...baseEnv,
      ...realAgentEnv,
      ...langfuseEnv,
      LLM_REASONING_EFFORT_SYNTHESIS: "max",
    }).LLM_REASONING_EFFORT_SYNTHESIS).toBe("max");
  });

  it("allows the real Agent configuration without online search", () => {
    expect(loadServerEnv({
      ...baseEnv,
      ...realAgentEnv,
      ...langfuseEnv,
      TAVILY_API_KEY: "",
    }).TAVILY_API_KEY).toBeUndefined();
  });

  it("rejects missing LANGFUSE_SECRET_KEY instead of silently disabling tracing", () => {
    expect(() => loadServerEnv({
      ...baseEnv,
      ...realAgentEnv,
      LANGFUSE_BASE_URL: langfuseEnv.LANGFUSE_BASE_URL,
      LANGFUSE_PUBLIC_KEY: langfuseEnv.LANGFUSE_PUBLIC_KEY,
    })).toThrow(/LANGFUSE_SECRET_KEY/);
  });

  it("defaults the Langfuse tracing environment to local", () => {
    expect(loadServerEnv({
      ...baseEnv,
      ...realAgentEnv,
      ...langfuseEnv,
    }).LANGFUSE_TRACING_ENVIRONMENT).toBe("local");
  });
});
