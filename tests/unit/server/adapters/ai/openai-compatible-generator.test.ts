import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { OpenAICompatibleGenerator } from "@/server/adapters/ai/openai-compatible-generator";

describe("OpenAICompatibleGenerator", () => {
  it("sends structured requests to the configured chat-completions model", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);

      expect(request.url).toBe("https://llm.example/v1/chat/completions");
      expect(request.headers.get("authorization")).toBe("Bearer test-key");
      expect((await request.json()).model).toBe("test-model");

      return Response.json({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 0,
        model: "test-model",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: '{"status":"ok"}' },
          },
        ],
        usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
      });
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
});
