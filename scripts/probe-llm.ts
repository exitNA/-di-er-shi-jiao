import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { Output, streamText, ToolLoopAgent, tool } from "ai";
import { z } from "zod";
import { loadServerEnv } from "../src/server/config/env";

export async function runLlmProbe() {
  const env = loadServerEnv();
  if (!env.LLM_BASE_URL || !env.LLM_API_KEY || !env.LLM_MODEL_ID) {
    throw new Error("LLM_BASE_URL, LLM_API_KEY, and LLM_MODEL_ID are required");
  }

  const provider = createOpenAICompatible({
    name: "secondPerspective",
    apiKey: env.LLM_API_KEY,
    baseURL: env.LLM_BASE_URL.replace(/\/$/, ""),
    supportsStructuredOutputs: true,
  });
  const startedAt = performance.now();
  const agent = new ToolLoopAgent({
    model: provider(env.LLM_MODEL_ID),
    tools: {
      echo: tool({
        description: "Echoes a message exactly.",
        inputSchema: z.object({ message: z.string() }),
        execute: async ({ message }) => message,
      }),
    },
    prepareStep: ({ stepNumber }) => ({
      toolChoice: stepNumber === 0 ? "required" : "none",
    }),
    output: Output.object({
      schema: z.object({
        chinese: z.literal("通过"),
        evidence: z.string().min(1),
      }),
    }),
  });
  const structured = await agent.generate({
    prompt: "Call echo with a short message, then return the required structured result.",
  });
  const streamed = await streamText({
    model: provider(env.LLM_MODEL_ID),
    prompt: "Reply with one short sentence.",
  });
  let textChunks = 0;
  for await (const chunk of streamed.textStream) {
    if (chunk) textChunks += 1;
  }
  if (textChunks === 0) throw new Error("LLM stream contained no text chunks");

  return {
    modelId: env.LLM_MODEL_ID,
    structuredOutput: structured.output.chinese === "通过" && structured.output.evidence.length > 0,
    toolCall: structured.toolCalls.some((call) => call.toolName === "echo"),
    streamedText: textChunks > 0,
    inputTokens: (structured.usage.inputTokens ?? 0) + ((await streamed.usage).inputTokens ?? 0),
    outputTokens: (structured.usage.outputTokens ?? 0) + ((await streamed.usage).outputTokens ?? 0),
    latencyMs: Math.round(performance.now() - startedAt),
  };
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  runLlmProbe()
    .then((result) => console.log(JSON.stringify(result)))
    .catch(() => {
      console.error(
        JSON.stringify({
          modelId: process.env.LLM_MODEL_ID ?? "",
          structuredOutput: false,
          toolCall: false,
          streamedText: false,
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: 0,
        }),
      );
      process.exitCode = 1;
    });
}
