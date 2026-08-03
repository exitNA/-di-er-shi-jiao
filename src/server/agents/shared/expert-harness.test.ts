import { argumentModuleSchema } from "@/features/analysis/domain/contracts";
import { analyzeArgument, createArgumentExpert } from "@/server/agents/argument/agent";
import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createExpertHarness, type ExpertSessionInput } from "./expert-harness";

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
      systemPrompt: "test",
      resourceDir: "/test",
      createSession: async () => invalidSession,
    });

    await expect(harness.run({ material: "claim" })).rejects.toMatchObject({ code: "INVALID_EXPERT_RESULT" });
  });

  it("registers the completion tool and returns its validated value", async () => {
    let customTools: Array<{ name: string }> = [];
    let sessionInput: ExpertSessionInput | undefined;
    const listeners: Array<(event: unknown) => void> = [];
    const session = {
      async prompt() {
        listeners.forEach((listener) => listener({
          type: "tool_execution_end",
          toolName: "complete",
          result: { details: { value: { answer: "done" } } },
        }));
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
      systemPrompt: "test",
      resourceDir: "/test",
      async createSession(input) {
        customTools = input.customTools;
        sessionInput = input;
        return session;
      },
    });

    await expect(harness.run({ material: "claim", systemPrompt: "resolved" })).resolves.toMatchObject({
      value: { answer: "done" },
      usage: { inputTokens: 3, outputTokens: 5 },
    });
    expect(customTools).toEqual([expect.objectContaining({ name: "complete" })]);
    expect(sessionInput).toMatchObject({ resourceDir: "/test", systemPrompt: "resolved" });
  });

  it("passes the factual-only argument instruction to its Pi session", async () => {
    const listeners: Array<(event: unknown) => void> = [];
    let sessionInput: ExpertSessionInput | undefined;
    const value = argumentModuleSchema.parse({
      factualOnly: true,
      claims: [],
      evidence: [],
      assumptions: [],
      reasoningSteps: [],
      conclusions: [],
      gaps: [],
      factualStatements: [],
    });
    const expert = createArgumentExpert(async (input) => {
      sessionInput = input;
      return {
        async prompt() {
          listeners.forEach((listener) => listener({
            type: "tool_execution_end",
            toolName: "complete",
            result: { details: { value } },
          }));
        },
        async waitForIdle() {},
        subscribe(listener: (event: unknown) => void) {
          listeners.push(listener);
          return () => {};
        },
      };
    });

    await analyzeArgument(expert, { material: "可核对事实", factualOnly: true });

    expect(sessionInput?.resourceDir).toMatch(/src\/server\/agents\/argument$/);
    expect(sessionInput?.systemPrompt).toContain("仅提取这些事实，不推演立场");
  });
});
