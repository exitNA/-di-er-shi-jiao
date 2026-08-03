import "server-only";

import path from "node:path";

import {
  createAgentSession,
  DefaultResourceLoader,
  type AgentSession,
  type AgentSessionEvent,
  ModelRuntime,
  type PromptOptions,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

import { withLangfuseObservation } from "@/server/observability/langfuse";

export interface PiSessionInput {
  systemPrompt: string;
  customTools: ToolDefinition[];
  modelRuntime: ModelRuntime;
  model: NonNullable<ReturnType<ModelRuntime["getModel"]>>;
  resourceDir: string;
}

export type PiModelRuntimeInput = {
  apiKey: string;
  baseURL: string;
  modelId: string;
};

type PiAssistantUsage = Extract<
  Extract<AgentSessionEvent, { type: "message_end" }>["message"],
  { role: "assistant" }
>["usage"];

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
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
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
      },
    ],
  });
  await loader.reload();

  const { session } = await createAgentSession({
    cwd: input.resourceDir,
    resourceLoader: loader,
    customTools: input.customTools,
    noTools: "builtin",
    sessionManager: SessionManager.inMemory(input.resourceDir),
    settingsManager,
    modelRuntime: input.modelRuntime,
    model: input.model,
  });

  observePrompts(session, input);
  return session;
}

function observePrompts(session: AgentSession, input: PiSessionInput): void {
  const prompt = session.prompt.bind(session);
  session.prompt = (text: string, options?: PromptOptions) => withLangfuseObservation(
    {
      name: "pi.generation",
      asType: "generation",
      input: {
        systemPrompt: input.systemPrompt,
        messages: [{ role: "user", content: text }],
      },
      metadata: {
        agentId: path.basename(input.resourceDir),
        modelId: input.model.id,
      },
    },
    async (observation) => {
      const assistant: unknown[] = [];
      const toolResults: Array<Record<string, unknown>> = [];
      const usageDetails = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
      const costDetails = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
      let model = input.model.id;
      let stopReason: string | undefined;
      let errorMessage: string | undefined;
      const unsubscribe = session.subscribe((event) => {
        if (event.type === "message_end" && event.message.role === "assistant") {
          assistant.push({
            content: event.message.content,
            stopReason: event.message.stopReason,
            ...(event.message.errorMessage ? { errorMessage: event.message.errorMessage } : {}),
          });
          model = event.message.model;
          stopReason = event.message.stopReason;
          errorMessage = event.message.errorMessage;
          addUsage(usageDetails, costDetails, event.message.usage);
        } else if (event.type === "tool_execution_end") {
          toolResults.push({
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            result: event.result,
            isError: event.isError,
          });
        }
      });

      try {
        await prompt(text, options);
      } catch (error) {
        observation.update({
          level: "ERROR",
          statusMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        unsubscribe();
        observation.update({
          output: { assistant, toolResults },
          model,
          usageDetails,
          costDetails,
          ...(stopReason === "aborted"
            ? { level: "WARNING", statusMessage: errorMessage ?? "aborted" }
            : stopReason === "error"
              ? { level: "ERROR", statusMessage: errorMessage ?? "provider error" }
              : {}),
        });
      }
    },
  );
}

function addUsage(
  usageDetails: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number },
  costDetails: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number },
  usage: PiAssistantUsage,
): void {
  usageDetails.input += usage.input;
  usageDetails.output += usage.output;
  usageDetails.cacheRead += usage.cacheRead;
  usageDetails.cacheWrite += usage.cacheWrite;
  usageDetails.total += usage.totalTokens;
  costDetails.input += usage.cost.input;
  costDetails.output += usage.cost.output;
  costDetails.cacheRead += usage.cost.cacheRead;
  costDetails.cacheWrite += usage.cost.cacheWrite;
  costDetails.total += usage.cost.total;
}
