import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import type {
  AgentToolResult,
  RunPeerExpertInput,
} from "../../workspace-tool-executor";

export type DelegateExpertToolInput = {
  workspaceId: string;
  agentRunId: string;
  signal?: AbortSignal;
  messageId?: string;
  target?: RunPeerExpertInput["target"];
  runExpert(input: RunPeerExpertInput): Promise<AgentToolResult>;
};

export function createDelegateExpertTool(input: DelegateExpertToolInput): ToolDefinition {
  return defineTool({
    name: "delegate_expert",
    label: "Delegate expert",
    description: "Delegate a task to one peer expert using server-owned workspace context.",
    promptSnippet: "Use delegate_expert to ask the most relevant peer expert for work.",
    parameters: Type.Object({
      expert: Type.Union([
        Type.Literal("argument"),
        Type.Literal("sources"),
        Type.Literal("perspectives"),
        Type.Literal("risks"),
        Type.Literal("synthesis"),
      ]),
      task: Type.Optional(Type.String({ maxLength: 2_000 })),
    }),
    async execute(_id, params) {
      const result = await input.runExpert({
        workspaceId: input.workspaceId,
        agentRunId: input.agentRunId,
        signal: input.signal,
        expert: params.expert,
        ...(params.task ? { task: params.task } : {}),
        ...(input.messageId ? { messageId: input.messageId } : {}),
        ...(input.target ? { target: input.target } : {}),
      });
      return toolResult(result, [input.workspaceId, input.agentRunId]);
    },
  });
}

export function toolResult(result: AgentToolResult, redactions: readonly string[]) {
  const text = result.ok ? result.summary : `未完成：${result.code}。`;
  return {
    content: [{
      type: "text" as const,
      text: redactions.reduce(
        (summary, value) => value ? summary.replaceAll(value, "[REDACTED]") : summary,
        text,
      ),
    }],
    details: { ok: result.ok },
  };
}
