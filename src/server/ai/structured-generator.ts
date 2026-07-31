import { z } from "zod";

export type GenerationUsage = {
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
};

export type StructuredGenerationInput<T> = {
  operation: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  abortSignal?: AbortSignal;
};

export interface StructuredGenerator {
  generate<T>(input: StructuredGenerationInput<T>): Promise<{ value: T; usage: GenerationUsage }>;
}
