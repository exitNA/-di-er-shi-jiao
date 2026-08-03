import "server-only";

import {
  createAgentSession,
  DefaultResourceLoader,
  type AgentSession,
  type ModelRuntime,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

export interface PiSessionInput {
  systemPrompt: string;
  customTools: ToolDefinition[];
  modelRuntime: ModelRuntime;
  resourceDir: string;
}

export async function createPiSession(input: PiSessionInput): Promise<AgentSession> {
  const settingsManager = SettingsManager.inMemory();
  const loader = new DefaultResourceLoader({
    cwd: input.resourceDir,
    agentDir: input.resourceDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => input.systemPrompt,
    appendSystemPromptOverride: () => [],
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
  });
  session.agent.state.systemPrompt = input.systemPrompt;

  return session;
}
