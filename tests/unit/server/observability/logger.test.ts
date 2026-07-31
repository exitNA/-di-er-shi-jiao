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

  it("drops arbitrary and sensitive details outside the field allowlist", () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => {});

    logError({
      operation: "llm.generate",
      errorCode: "GENERATION_FAILED",
      jobId: "job-1",
      moduleType: "sources",
      durationMs: 50,
      attempt: 3,
      email: "secret@example.com",
      material: "secret-material",
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
    } as unknown as Parameters<typeof logError>[0]);

    const serialized = String(output.mock.calls[0]?.[0]);
    expect(JSON.parse(serialized)).toEqual({
      level: "error",
      operation: "llm.generate",
      errorCode: "GENERATION_FAILED",
      jobId: "job-1",
      moduleType: "sources",
      durationMs: 50,
      attempt: 3,
    });
    expect(serialized).not.toMatch(/secret|details|email|material/);
  });
});
