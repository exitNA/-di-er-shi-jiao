import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import type {
  StructuredGenerationInput,
  StructuredGenerator,
} from "@/server/ai/structured-generator";

export type OpenAICompatibleGeneratorConfig = {
  apiKey: string;
  baseURL: string;
  modelId: string;
  fetch?: typeof globalThis.fetch;
};

export type GeneratorErrorCode =
  | "LLM_TIMEOUT"
  | "LLM_AUTHENTICATION_FAILED"
  | "LLM_RATE_LIMITED"
  | "LLM_SCHEMA_INVALID"
  | "LLM_UNKNOWN_ERROR";

export class GeneratorError extends Error {
  constructor(
    public readonly code: GeneratorErrorCode,
    cause?: unknown,
  ) {
    super(code, { cause });
    this.name = "GeneratorError";
  }
}

export class OpenAICompatibleGenerator implements StructuredGenerator {
  private readonly provider;

  constructor(private readonly config: OpenAICompatibleGeneratorConfig) {
    this.provider = createOpenAICompatible({
      name: "secondPerspective",
      apiKey: config.apiKey,
      baseURL: config.baseURL.replace(/\/$/, ""),
      supportsStructuredOutputs: true,
      fetch: config.fetch,
    });
  }

  async generate<T>(input: StructuredGenerationInput<T>): Promise<{
    value: T;
    usage: { inputTokens: number; outputTokens: number; latencyMs: number };
  }> {
    try {
      return await this.generateOnce(input, false);
    } catch (error) {
      if (!NoObjectGeneratedError.isInstance(error)) {
        throw toGeneratorError(error);
      }

      try {
        return await this.generateOnce(input, true);
      } catch (retryError) {
        throw toGeneratorError(retryError);
      }
    }
  }

  private async generateOnce<T>(
    input: StructuredGenerationInput<T>,
    retrying: boolean,
  ): Promise<{
    value: T;
    usage: { inputTokens: number; outputTokens: number; latencyMs: number };
  }> {
    const startedAt = performance.now();
    const result = await generateText({
      model: this.provider(this.config.modelId),
      system: retrying
        ? `${input.system}\n\nThe previous response violated the requested schema. Return only valid JSON matching it.`
        : input.system,
      prompt: input.prompt,
      output: Output.object({ schema: input.schema }),
      abortSignal: input.abortSignal,
    });

    return {
      value: result.output,
      usage: {
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        latencyMs: Math.round(performance.now() - startedAt),
      },
    };
  }
}

function toGeneratorError(error: unknown): GeneratorError {
  if (error instanceof GeneratorError) return error;
  if (NoObjectGeneratedError.isInstance(error)) {
    return new GeneratorError("LLM_SCHEMA_INVALID", error);
  }

  const statusCode =
    typeof error === "object" && error !== null && "statusCode" in error
      ? (error as { statusCode?: unknown }).statusCode
      : undefined;
  if (statusCode === 401 || statusCode === 403) {
    return new GeneratorError("LLM_AUTHENTICATION_FAILED", error);
  }
  if (statusCode === 429) return new GeneratorError("LLM_RATE_LIMITED", error);

  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError" || /timeout/i.test(error instanceof Error ? error.message : "")) {
    return new GeneratorError("LLM_TIMEOUT", error);
  }

  return new GeneratorError("LLM_UNKNOWN_ERROR", error);
}
