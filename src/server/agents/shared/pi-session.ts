import "server-only";

import {
  createAgentSession,
  DefaultResourceLoader,
  type AgentSession,
  type ModelRuntime,
  SessionManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

export interface PiSessionInput {
  systemPrompt: string;
  customTools: ToolDefinition[];
  modelRuntime: ModelRuntime;
}

export async function createPiSession(input: PiSessionInput): Promise<AgentSession> {
  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: process.cwd(),
    systemPromptOverride: () => input.systemPrompt,
  });
  await loader.reload();

  return (
    await createAgentSession({
      resourceLoader: loader,
      customTools: input.customTools,
      noTools: "builtin",
      sessionManager: SessionManager.inMemory(),
      modelRuntime: input.modelRuntime,
    })
  ).session;
}
