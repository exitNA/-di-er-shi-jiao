import { argumentModuleSchema } from "@/features/analysis/domain/contracts";
import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createExpertHarness } from "./expert-harness";

const invalidSession = {
  prompt: vi.fn(),
  subscribe(listener: (event: unknown) => void) {
    listener({
      type: "tool_execution_end",
      toolName: "complete",
      result: { details: { value: {} } },
    });
    return () => {};
  },
  waitForIdle: vi.fn(),
};

describe("createExpertHarness", () => {
  it("rejects expert output that misses its result schema", async () => {
    const harness = createExpertHarness({
      schema: argumentModuleSchema,
      completionSchema: Type.Object({}, { additionalProperties: true }),
      createSession: async () => invalidSession,
    });

    await expect(harness.run({ material: "claim" })).rejects.toMatchObject({ code: "INVALID_EXPERT_RESULT" });
  });

  it("registers the completion tool and returns its validated value", async () => {
    let completion: { execute(id: string, params: { answer: string }): Promise<unknown> } | undefined;
    const listeners: Array<(event: unknown) => void> = [];
    const session = {
      async prompt() {
        const result = await completion?.execute("call", { answer: "done" });
        listeners.forEach((listener) => listener({ type: "tool_execution_end", toolName: "complete", result }));
      },
      async waitForIdle() {},
      subscribe(listener: (event: unknown) => void) {
        listeners.push(listener);
        return () => {};
      },
      getSessionStats() {
        return { tokens: { input: 3, output: 5 } };
      },
    };
    const harness = createExpertHarness({
      schema: z.object({ answer: z.string() }),
      completionSchema: Type.Object({ answer: Type.String() }),
      async createSession(customTools) {
        completion = customTools[0] as typeof completion;
        return session;
      },
    });

    await expect(harness.run({ material: "claim" })).resolves.toMatchObject({
      value: { answer: "done" },
      usage: { inputTokens: 3, outputTokens: 5 },
    });
  });
});
