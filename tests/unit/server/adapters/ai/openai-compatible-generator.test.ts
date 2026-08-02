import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { generateText } from "ai";
import {
  createOpenAICompatibleLanguageModel,
  OpenAICompatibleGenerator,
} from "@/server/adapters/ai/openai-compatible-generator";

describe("OpenAICompatibleGenerator", () => {
  it("sends structured requests to the configured chat-completions model", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);

      expect(request.url).toBe("https://llm.example/v1/chat/completions");
      expect(request.headers.get("authorization")).toBe("Bearer test-key");
      expect((await request.json()).model).toBe("test-model");

      return chatCompletionStream('{"status":"ok"}', 7, 3);
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

function chatCompletionStream(content: string, promptTokens: number, completionTokens: number) {
  const body = [
    `data: ${JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion.chunk",
      created: 0,
      model: "test-model",
      choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
    })}\n\n`,
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
