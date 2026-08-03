import "server-only";

import path from "node:path";

import {
  createAgentSession,
  DefaultResourceLoader,
  type AgentSession,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

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

  return session;
}
