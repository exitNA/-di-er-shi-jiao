import "server-only";

import path from "node:path";

import { context as otelContext, trace, type Context } from "@opentelemetry/api";
import {
  createAgentSession,
  DefaultResourceLoader,
  type AgentSession,
  ModelRuntime,
  type PromptOptions,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

import {
  startObservation,
  type ObservationHandle,
} from "@/server/observability/observations";

type PiThinkingLevel = NonNullable<Parameters<typeof createAgentSession>[0]>["thinkingLevel"];

// manager：客户经理；argument：论证分析；sources：信源研究。
// perspectives：多视角挑战；risks：风险审查；synthesis：综合审校。

export interface PiSessionInput {
  systemPrompt: string;
  customTools: ToolDefinition[];
  modelRuntime: ModelRuntime;
  model: NonNullable<ReturnType<ModelRuntime["getModel"]>>;
  resourceDir: string;
  reasoningEffort: PiThinkingLevel;
}

export type PiModelRuntimeInput = {
  apiKey: string;
  baseURL: string;
  modelId: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

export async function createProjectPiModelRuntime(input: PiModelRuntimeInput) {
  type CredentialStore = NonNullable<NonNullable<Parameters<typeof ModelRuntime.create>[0]>["credentials"]>;
  const credentials: CredentialStore = {
    async read() {
      return undefined;
    },
    async modify(_provider, modify) {
      return modify(undefined);
    },
    async delete() {},
    async list() {
      return [];
    },
  };
  const modelRuntime = await ModelRuntime.create({
    credentials,
    modelsPath: null,
  });
  modelRuntime.registerProvider("second-perspective", {
    name: "Second Perspective",
    baseUrl: input.baseURL.replace(/\/$/, ""),
    apiKey: input.apiKey,
    api: "openai-completions",
    models: [{
      id: input.modelId,
      name: input.modelId,
      reasoning: true,
      thinkingLevelMap: {
        minimal: null,
        low: "low",
        medium: "low",
        high: "high",
        xhigh: "high",
        max: "max",
      },
      input: ["text"],
      cost: {
        input: input.inputUsdPerMillion,
        output: input.outputUsdPerMillion,
        cacheRead: 0,
        cacheWrite: 0,
      },
      contextWindow: 128_000,
      maxTokens: 8_192,
    }],
  });
  await modelRuntime.setRuntimeApiKey("second-perspective", input.apiKey);
  const model = modelRuntime.getModel("second-perspective", input.modelId);
  if (!model) throw new Error(`Pi model not registered: ${input.modelId}`);
  return { model, modelRuntime };
}

export async function createPiSession(input: PiSessionInput): Promise<AgentSession> {
  const settingsManager = SettingsManager.inMemory();
  const agentId = path.basename(input.resourceDir);
  let generation: ObservationHandle | undefined;
  let generationContext: Context | undefined;
  let turnIndex = 0;

  const endOpenGeneration = (error?: unknown): void => {
    if (!generation) return;
    generation.end(error);
    generation = undefined;
    generationContext = undefined;
  };

  const loader = new DefaultResourceLoader({
    cwd: input.resourceDir,
    agentDir: input.resourceDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    additionalSkillPaths: [path.join(input.resourceDir, "skills")],
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => input.systemPrompt,
    appendSystemPromptOverride: () => [],
    extensionFactories: [
      (pi) => {
        pi.on("before_agent_start", () => ({ systemPrompt: input.systemPrompt }));
        pi.on("turn_start", (event) => {
          if (generation) {
            endOpenGeneration(new Error("Pi started a new model turn before ending the previous one"));
          }
          turnIndex = event.turnIndex;
          generation = startObservation({
            name: agentId,
            asType: "generation",
            input: { systemPrompt: input.systemPrompt },
            metadata: {
              agentId,
              modelId: input.model.id,
              turnIndex: String(turnIndex),
            },
          });
          generationContext = trace.setSpan(otelContext.active(), generation.otelSpan);
        });
        pi.on("context", (event) => {
          generation?.update({
            input: {
              systemPrompt: input.systemPrompt,
              messages: event.messages,
            },
            model: input.model.id,
          });
        });
        pi.on("turn_end", (event) => {
          if (!generation) return;
          if (event.message.role !== "assistant") {
            endOpenGeneration(new Error("Pi model turn ended without an assistant response"));
            return;
          }

          const { usage } = event.message;
          generation.update({
            output: {
              assistant: event.message,
              toolResults: event.toolResults,
            },
            model: event.message.model,
            usageDetails: {
              input: usage.input,
              output: usage.output,
              cacheRead: usage.cacheRead,
              cacheWrite: usage.cacheWrite,
              total: usage.totalTokens,
            },
            costDetails: usage.cost,
            ...(event.message.stopReason === "aborted"
              ? {
                  level: "WARNING" as const,
                  statusMessage: event.message.errorMessage ?? "aborted",
                }
              : event.message.stopReason === "error"
                ? {
                    level: "ERROR" as const,
                    statusMessage: event.message.errorMessage ?? "provider error",
                  }
                : {}),
          });
          endOpenGeneration();
        });
        pi.on("agent_end", () => {
          if (generation) {
            endOpenGeneration(new Error("Pi agent ended before the current model turn completed"));
          }
        });
      },
    ],
  });
  await loader.reload();

  const { session } = await createAgentSession({
    cwd: input.resourceDir,
    resourceLoader: loader,
    customTools: input.customTools.map((tool): ToolDefinition => ({
      ...tool,
      execute: (...args: Parameters<ToolDefinition["execute"]>) => generationContext
        ? otelContext.with(generationContext, () => tool.execute(...args))
        : tool.execute(...args),
    })),
    noTools: "builtin",
    sessionManager: SessionManager.inMemory(input.resourceDir),
    settingsManager,
    modelRuntime: input.modelRuntime,
    model: input.model,
    thinkingLevel: input.reasoningEffort,
  });

  const prompt = session.prompt.bind(session);
  session.prompt = async (text: string, options?: PromptOptions): Promise<void> => {
    try {
      await prompt(text, options);
    } catch (error) {
      endOpenGeneration(error);
      throw error;
    }
  };
  return session;
}
