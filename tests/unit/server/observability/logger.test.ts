import { describe, expect, it, vi } from "vitest";

import { logError, logInfo } from "@/server/observability/logger";

describe("safe structured logger", () => {
  it("writes the operational fields as JSON", () => {
    const output = vi.spyOn(console, "info").mockImplementation(() => {});

    logInfo({
      jobId: "job-1",
      operation: "argument.baseline",
      durationMs: 42,
      attempt: 2,
    });

    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({
      level: "info",
      jobId: "job-1",
      operation: "argument.baseline",
      durationMs: 42,
      attempt: 2,
    });
  });

  it("recursively redacts every sensitive key", () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => {});

    logError({
      operation: "llm.generate",
      errorCode: "GENERATION_FAILED",
      details: {
        content: "secret-material",
        username: "secret-reader",
        nested: {
          password: "secret-password",
          sessionToken: "secret-session",
          prompt: "secret-prompt",
          response: "secret-response",
          apiKey: "secret-api-key",
        },
      },
    });

    const serialized = String(output.mock.calls[0]?.[0]);
    expect(serialized).not.toContain("secret-");
    expect(serialized.match(/\[REDACTED\]/g)).toHaveLength(7);
  });
});
