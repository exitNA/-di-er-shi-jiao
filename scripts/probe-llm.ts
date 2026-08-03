import { resolve } from "node:path";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { loadServerEnv } from "../src/server/config/env";
import {
  createPiSession,
  createProjectPiModelRuntime,
} from "../src/server/agents/shared/pi-session";

export async function runLlmProbe() {
  const env = loadServerEnv();
  const { model, modelRuntime } = await createProjectPiModelRuntime({
    baseURL: env.LLM_BASE_URL,
    apiKey: env.LLM_API_KEY,
    modelId: env.LLM_MODEL_ID,
    inputUsdPerMillion: env.LLM_INPUT_USD_PER_MILLION,
    outputUsdPerMillion: env.LLM_OUTPUT_USD_PER_MILLION,
  });
  let submitted: { chinese: "通过"; evidence: string } | undefined;
  const complete = defineTool({
    name: "complete_probe",
    label: "Complete probe",
    description: "Submit the probe result.",
    parameters: Type.Object({
      chinese: Type.Literal("通过"),
      evidence: Type.String({ minLength: 1 }),
    }),
    async execute(_id, params) {
      submitted = params;
      return {
        content: [{ type: "text" as const, text: "accepted" }],
        details: { accepted: true },
        terminate: true,
      };
    },
  });
  const session = await createPiSession({
    model,
    modelRuntime,
    customTools: [complete],
    resourceDir: resolve(process.cwd(), "src/server/agents/manager"),
    systemPrompt: "调用 complete_probe 提交 chinese=通过 和非空 evidence。",
  });
  const startedAt = performance.now();
  let streamedEvents = 0;
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "message_update") streamedEvents += 1;
  });

  try {
    await session.prompt("执行连通性检查。");
    await session.waitForIdle();
    const stats = session.getSessionStats().tokens;
    return {
      modelId: env.LLM_MODEL_ID,
      structuredOutput: submitted?.chinese === "通过" && submitted.evidence.length > 0,
      toolCall: submitted !== undefined,
      streamedEvents: streamedEvents > 0,
      inputTokens: stats.input,
      outputTokens: stats.output,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } finally {
    unsubscribe();
    session.dispose();
  }
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  runLlmProbe()
    .then((result) => console.log(JSON.stringify(result)))
    .catch(() => {
      console.error(JSON.stringify({
        modelId: process.env.LLM_MODEL_ID ?? "",
        structuredOutput: false,
        toolCall: false,
        streamedEvents: false,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
      }));
      process.exitCode = 1;
    });
}
