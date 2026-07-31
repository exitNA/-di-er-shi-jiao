import { z } from "zod";
import { LLMClient, Config } from "coze-coding-dev-sdk";
import type {
  StructuredGenerationInput,
  StructuredGenerator,
  GenerationUsage,
} from "@/server/ai/structured-generator";

export type CozeLlmGeneratorConfig = {
  model?: string;
  temperature?: number;
};

export class CozeLlmGenerator implements StructuredGenerator {
  private readonly client: LLMClient;
  private readonly model: string;
  private readonly temperature: number;

  constructor(config: CozeLlmGeneratorConfig = {}) {
    this.client = new LLMClient(new Config());
    this.model = config.model ?? "doubao-seed-2-0-lite-260215";
    this.temperature = config.temperature ?? 0.3;
  }

  async generate<T>(input: StructuredGenerationInput<T>): Promise<{
    value: T;
    usage: GenerationUsage;
  }> {
    const jsonSchema = z.toJSONSchema(input.schema);

    const schemaInstruction = [
      "You MUST respond with ONLY valid JSON matching this schema. Do not include any text before or after the JSON.",
      "",
      "JSON Schema:",
      JSON.stringify(jsonSchema, null, 2),
    ].join("\n");

    const systemPrompt = [input.system, "", schemaInstruction].join("\n");

    const messages: Array<{ role: "system" | "user"; content: string }> = [
      { role: "system", content: systemPrompt },
      { role: "user", content: input.prompt },
    ];

    const startedAt = performance.now();

    try {
      const response = await this.client.invoke(messages, {
        model: this.model,
        temperature: this.temperature,
      });

      const latencyMs = Math.round(performance.now() - startedAt);
      const parsed = this.parseJsonResponse<T>(response.content, input.schema);

      return {
        value: parsed,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          latencyMs,
        },
      };
    } catch (error) {
      if (error instanceof GeneratorParseError) {
        throw error;
      }
      throw new GeneratorInvokeError(
        error instanceof Error ? error.message : String(error),
        error,
      );
    }
  }

  private parseJsonResponse<T>(raw: string, schema: import("zod").ZodType<T>): T {
    const jsonStr = this.extractJson(raw);
    let parsed: unknown;

    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      throw new GeneratorParseError(
        "Failed to parse LLM response as JSON",
        raw.slice(0, 500),
      );
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new GeneratorParseError(
        `LLM response does not match schema: ${result.error.message}`,
        JSON.stringify(parsed).slice(0, 500),
      );
    }

    return result.data;
  }

  private extractJson(raw: string): string {
    const trimmed = raw.trim();

    // Try direct JSON parse first
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      return trimmed;
    }

    // Extract from markdown code block
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }

    // Extract first JSON object or array
    const jsonMatch = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch) {
      return jsonMatch[1];
    }

    return trimmed;
  }
}

export class GeneratorParseError extends Error {
  constructor(
    message: string,
    public readonly rawContent: string,
  ) {
    super(message);
    this.name = "GeneratorParseError";
  }
}

export class GeneratorInvokeError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GeneratorInvokeError";
  }
}
