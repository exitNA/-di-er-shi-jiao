import { describe, expect, it } from "vitest";
import { loadServerEnv } from "@/server/config/env";

describe("loadServerEnv", () => {
  it("requires LLM settings only for the real agent adapter", () => {
    expect(() =>
      loadServerEnv({
        NODE_ENV: "test",
        APP_URL: "http://127.0.0.1:3000",
        DATABASE_URL: "postgres://app:app@127.0.0.1:54329/second_perspective",
        AUTH_SECRET: "test-auth-secret-that-is-at-least-32-bytes",
        AGENT_ADAPTER: "openai-compatible",
        ANALYSIS_RUNTIME: "in-process",
      }),
    ).toThrow(/LLM_BASE_URL/);
  });
});
