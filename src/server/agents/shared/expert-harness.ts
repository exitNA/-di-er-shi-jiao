import "server-only";

import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import { Type, type TSchema } from "typebox";
import { z } from "zod";

import { withLangfuseObservation } from "@/server/observability/langfuse";
import type { ExpertResult } from "../expert-suite";

export type ExpertRunRequest = {
  prompt?: string;
  material?: string;
  operation?: string;
  systemPrompt?: string;
  abortSignal?: AbortSignal;
};

export type ExpertSessionInput = {
  customTools: ToolDefinition[];
  resourceDir: string;
  systemPrompt: string;
};

export type ExpertSession = {
  prompt(text: string): Promise<void>;
  waitForIdle(): Promise<void>;
  subscribe(listener: (event: unknown) => void): () => void;
  abort?(): Promise<void>;
  dispose?(): void;
  getSessionStats?(): { tokens: { input: number; output: number } };
};

type ExpertHarnessInput<T> = {
  schema: z.ZodType<T>;
  completionSchema: TSchema;
  resourceDir: string;
  systemPrompt: string;
  createSession(input: ExpertSessionInput): Promise<ExpertSession>;
};

export type ExpertSessionFactory = ExpertHarnessInput<unknown>["createSession"];

export type ExpertHarness<T> = {
  run(request: ExpertRunRequest): Promise<ExpertResult<T>>;
};

export class ExpertHarnessError extends Error {
  readonly code = "INVALID_EXPERT_RESULT";

  constructor() {
    super("The expert did not submit a result matching its schema.");
  }
}

export function createExpertHarness<T>(input: ExpertHarnessInput<T>): ExpertHarness<T> {
  const complete = defineTool({
    name: "complete",
    label: "Complete analysis",
    description: "Submit the final structured result exactly once.",
    promptSnippet: "Submit the final structured result with complete.",
    promptGuidelines: ["Use complete as the final action and do not send a follow-up response."],
    parameters: input.completionSchema,
    async execute(_id, params) {
      return {
        content: [{ type: "text" as const, text: "accepted" }],
        details: { value: params },
        terminate: true,
      };
    },
  });

  return {
    async run(request) {
      const agentId = request.operation ?? path.basename(input.resourceDir);
      const systemPrompt = request.systemPrompt ?? input.systemPrompt;
      const prompt = request.prompt ?? request.material ?? "";
      return withLangfuseObservation(
        {
          name: `expert.${agentId}`,
          asType: "agent",
          input: { systemPrompt, messages: [{ role: "user", content: prompt }] },
          metadata: { agentId },
        },
        async () => {
          const session = await input.createSession({
            customTools: [complete],
            resourceDir: input.resourceDir,
            systemPrompt,
          });
          const startedAt = performance.now();
          let completed = false;
          let submitted: unknown;
          const unsubscribe = session.subscribe((event) => {
            if (!isCompleteResult(event) || completed) return;
            completed = true;
            submitted = event.result.details.value;
          });
          const abort = () => void session.abort?.();
          request.abortSignal?.addEventListener("abort", abort, { once: true });
          if (request.abortSignal?.aborted) abort();

          try {
            await session.prompt(prompt);
            await session.waitForIdle();
            const parsed = input.schema.safeParse(submitted);
            if (!completed || !parsed.success) throw new ExpertHarnessError();
            const tokens = session.getSessionStats?.().tokens;
            return {
              value: parsed.data,
              usage: {
                inputTokens: tokens?.input ?? 0,
                outputTokens: tokens?.output ?? 0,
                latencyMs: Math.round(performance.now() - startedAt),
              },
            };
          } finally {
            request.abortSignal?.removeEventListener("abort", abort);
            unsubscribe();
            session.dispose?.();
          }
        },
      );
    },
  };
}

export function zodCompletionSchema<T>(schema: z.ZodType<T>): TSchema {
  return Type.Unsafe<T>(z.toJSONSchema(schema) as TSchema);
}

export function expertResourceDir(agent: string): string {
  return path.resolve(process.cwd(), "src/server/agents", agent);
}

function isCompleteResult(event: unknown): event is { result: { details: { value: unknown } } } {
  if (!isRecord(event) || event.type !== "tool_execution_end" || event.toolName !== "complete") return false;
  return isRecord(event.result) && isRecord(event.result.details) && "value" in event.result.details;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
