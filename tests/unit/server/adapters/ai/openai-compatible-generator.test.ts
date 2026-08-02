import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { generateText } from "ai";
import {
  createOpenAICompatibleLanguageModel,
  OpenAICompatibleGenerator,
  redactLlmLogText,
} from "@/server/adapters/ai/openai-compatible-generator";

describe("OpenAICompatibleGenerator", () => {
  it("collects streamed JSON without requesting provider structured output", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);

      expect(request.url).toBe("https://llm.example/v1/chat/completions");
      expect(request.headers.get("authorization")).toBe("Bearer test-key");
      const body = await request.json() as Record<string, unknown>;
      expect(body.model).toBe("test-model");
      expect(body).not.toHaveProperty("response_format");

      return chatCompletionStream(['{"status":', '"ok"}'], 7, 3);
    });
    const generator = new OpenAICompatibleGenerator({
      apiKey: "test-key",
      baseURL: "https://llm.example/v1/",
      modelId: "test-model",
      fetch,
    });

    const result = await generator.generate({
      operation: "test",
      system: "Return the requested object.",
      prompt: "Reply with status ok.",
      schema: z.object({ status: z.literal("ok") }),
    });

    expect(result.value).toEqual({ status: "ok" });
    expect(result.usage).toMatchObject({ inputTokens: 7, outputTokens: 3 });
    expect(result.usage.latencyMs).toEqual(expect.any(Number));
  });

  it.each([
    ["```json\n{\"status\":\"ok\",}\n```", "a fenced response with a trailing comma"],
    ["Here is the result:\n{\"status\":\"ok\"}\nUse it carefully.", "JSON surrounded by explanatory text"],
  ])("parses %s", async (content) => {
    const generator = new OpenAICompatibleGenerator({
      apiKey: "test-key",
      baseURL: "https://llm.example/v1/",
      modelId: "test-model",
      fetch: vi.fn(async () => chatCompletionStream(content, 2, 2)),
    });

    await expect(generator.generate({
      operation: "test",
      system: "Return the requested object.",
      prompt: "Reply with status ok.",
      schema: z.object({ status: z.literal("ok") }),
    })).resolves.toMatchObject({ value: { status: "ok" } });
  });

  it("retries once when streamed text cannot be parsed against the schema", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(chatCompletionStream("not JSON", 2, 1))
      .mockResolvedValueOnce(chatCompletionStream('{"status":"ok"}', 3, 2));
    const generator = new OpenAICompatibleGenerator({
      apiKey: "test-key",
      baseURL: "https://llm.example/v1/",
      modelId: "test-model",
      fetch,
    });

    await expect(generator.generate({
      operation: "test",
      system: "Return the requested object.",
      prompt: "Reply with status ok.",
      schema: z.object({ status: z.literal("ok") }),
    })).resolves.toMatchObject({ value: { status: "ok" } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("redacts credentials before recording LLM input or output", () => {
    const redacted = redactLlmLogText(
      "Authorization: Bearer secret-token\napi_key=secret-key\n{\"apiKey\":\"sk-1234567890\"}",
    );

    expect(redacted).not.toContain("secret-token");
    expect(redacted).not.toContain("secret-key");
    expect(redacted).not.toContain("sk-1234567890");
    expect(redacted).toContain("[REDACTED]");
  });

  it("creates the language model with the same OpenAI-compatible settings", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(request.url).toBe("https://llm.example/v1/chat/completions");
      expect(request.headers.get("authorization")).toBe("Bearer test-key");

      return Response.json({
        id: "chatcmpl-agent",
        object: "chat.completion",
        created: 0,
        model: "test-model",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "done" },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    });

    const result = await generateText({
      model: createOpenAICompatibleLanguageModel({
        apiKey: "test-key",
        baseURL: "https://llm.example/v1/",
        modelId: "test-model",
        fetch,
      }),
      prompt: "Finish the Agent run.",
    });

    expect(result.text).toBe("done");
  });
});

function chatCompletionStream(content: string | string[], promptTokens: number, completionTokens: number) {
  const chunks = Array.isArray(content) ? content : [content];
  const body = [
    ...chunks.map((chunk) => `data: ${JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion.chunk",
      created: 0,
      model: "test-model",
      choices: [{ index: 0, delta: { role: "assistant", content: chunk }, finish_reason: null }],
    })}\n\n`),
    `data: ${JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion.chunk",
      created: 0,
      model: "test-model",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
    })}\n\n`,
    "data: [DONE]\n\n",
  ].join("");
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}
