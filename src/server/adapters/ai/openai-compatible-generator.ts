import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import { getLogger } from "@logtape/logtape";
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

const logger = getLogger(["second-perspective", "llm"]);

export function createOpenAICompatibleLanguageModel(
  config: OpenAICompatibleGeneratorConfig,
) {
  const provider = createOpenAICompatible({
    name: "secondPerspective",
    apiKey: config.apiKey,
    baseURL: config.baseURL.replace(/\/$/, ""),
    supportsStructuredOutputs: true,
    fetch: config.fetch,
  });
  return provider(config.modelId);
}

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
  private readonly model;

  constructor(config: OpenAICompatibleGeneratorConfig) {
    this.model = createOpenAICompatibleLanguageModel(config);
  }

  async generate<T>(input: StructuredGenerationInput<T>): Promise<{
    value: T;
    usage: { inputTokens: number; outputTokens: number; latencyMs: number };
  }> {
    try {
      return await this.generateOnce(input, false);
    } catch (error) {
      const generatorError = toGeneratorError(error);
      if (generatorError.code !== "LLM_SCHEMA_INVALID") throw generatorError;

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
    const attempt = retrying ? 2 : 1;
    const system = retrying
      ? `${input.system}\n\n上一次结果无法被应用解析。请返回与任务所需结构匹配的有效 JSON，不要使用 Markdown。`
      : input.system;
    logger.info("LLM stream started", {
      operation: input.operation,
      attempt,
      system: redactLlmLogText(system),
      prompt: redactLlmLogText(input.prompt),
    });
    const result = streamText({
      model: this.model,
      system,
      prompt: input.prompt,
      abortSignal: input.abortSignal,
    });

    let text = "";
    try {
      for await (const delta of result.textStream) text += delta;
    } catch (error) {
      logger.error("LLM stream failed", {
        operation: input.operation,
        attempt,
        system: redactLlmLogText(system),
        prompt: redactLlmLogText(input.prompt),
        output: redactLlmLogText(text),
        errorName: error instanceof Error ? error.name : "unknown",
      });
      throw error;
    }
    logger.info("LLM stream completed", {
      operation: input.operation,
      attempt,
      output: redactLlmLogText(text),
    });
    const output = parseStructuredOutput(text, input.schema);
    if (output === undefined) {
      throw new GeneratorError(
        "LLM_SCHEMA_INVALID",
        new Error("The generated text did not contain JSON matching the requested schema."),
      );
    }
    const usage = await result.usage;
    return {
      value: output,
      usage: {
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        latencyMs: Math.round(performance.now() - startedAt),
      },
    };
  }
}

function toGeneratorError(error: unknown): GeneratorError {
  if (error instanceof GeneratorError) return error;

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

export function redactLlmLogText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s"'`<>{}]+/gi, "Bearer [REDACTED]")
    .replace(/((?:["']?authorization["']?|["']?(?:api[_-]?key|x-api-key)["']?)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\r\n,;}\]]+)/gi, "$1[REDACTED]")
    .replace(/([?&](?:api[_-]?key|access_token|token)=)[^&#\s]+/gi, "$1[REDACTED]")
    .replace(/\b(?:sk|rk)-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]");
}

function parseStructuredOutput<T>(text: string, schema: StructuredGenerationInput<T>["schema"]): T | undefined {
  for (const candidate of jsonCandidates(text)) {
    const value = parseJson(candidate);
    if (value === undefined) continue;
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
  }
  return undefined;
}

function jsonCandidates(text: string): string[] {
  const candidates = [...fencedJsonCandidates(text), ...balancedJsonCandidates(text)];
  return [...new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean))];
}

function fencedJsonCandidates(text: string): string[] {
  return [...text.matchAll(/```(?:json|jsonc)?[ \t]*\r?\n?([\s\S]*?)```/gi)].map((match) => match[1]);
}

function balancedJsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{" && text[start] !== "[") continue;
    const end = findJsonEnd(text, start);
    if (end !== undefined) candidates.push(text.slice(start, end + 1));
  }
  return candidates;
}

function findJsonEnd(text: string, start: number): number | undefined {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{" || character === "[") {
      stack.push(character);
      continue;
    }
    if (character !== "}" && character !== "]") continue;
    const opening = stack.pop();
    if ((character === "}" && opening !== "{") || (character === "]" && opening !== "[")) return undefined;
    if (stack.length === 0) return index;
  }
  return undefined;
}

function parseJson(candidate: string): unknown | undefined {
  try {
    return JSON.parse(candidate.replace(/^\uFEFF/, ""));
  } catch {
    try {
      return JSON.parse(removeTrailingCommas(candidate).replace(/^\uFEFF/, ""));
    } catch {
      return undefined;
    }
  }
}

function removeTrailingCommas(text: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      result += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }
    if (character === ",") {
      let next = index + 1;
      while (/\s/.test(text[next] ?? "")) next += 1;
      if (text[next] === "}" || text[next] === "]") continue;
    }
    result += character;
  }
  return result;
}
