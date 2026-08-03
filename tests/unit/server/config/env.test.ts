import { describe, expect, it } from "vitest";
import { loadServerEnv } from "@/server/config/env";

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
    }).LLM_MODEL_ID).toBe("test-model");
  });

  it("allows the real Agent configuration without online search", () => {
    expect(loadServerEnv({
      ...baseEnv,
      ...realAgentEnv,
      TAVILY_API_KEY: "",
    }).TAVILY_API_KEY).toBeUndefined();
  });
});
