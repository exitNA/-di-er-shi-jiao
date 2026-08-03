import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import type {
  AgentToolResult,
  ReportActionName,
  RunReportActionInput,
} from "../../workspace-tool-executor";
import { toolResult } from "./delegate-expert";

type ReportActionToolInput = {
  workspaceId: string;
  agentRunId: string;
  kind: "baseline" | "challenge";
  signal?: AbortSignal;
  messageId?: string;
  target?: RunReportActionInput["target"];
  runReportAction(input: RunReportActionInput): Promise<AgentToolResult>;
};

export function createReportActionTool(input: ReportActionToolInput): ToolDefinition {
  const action = input.kind === "challenge"
    ? Type.Literal("review_target")
    : Type.Union([
        Type.Literal("review_draft"),
        Type.Literal("revise_report"),
        Type.Literal("publish_report"),
      ]);
  return defineTool({
    name: "report_action",
    label: "Report action",
    description: "Review, revise, validate, or publish the current report through server-side checks.",
    promptSnippet: "Use report_action for report lifecycle work after the needed expert results exist.",
    parameters: Type.Object({ action }),
    async execute(_id, params) {
      const result = await input.runReportAction({
        workspaceId: input.workspaceId,
        agentRunId: input.agentRunId,
        signal: input.signal,
        action: params.action as ReportActionName,
        ...(input.messageId ? { messageId: input.messageId } : {}),
        ...(input.target ? { target: input.target } : {}),
      });
      return toolResult(result, [input.workspaceId, input.agentRunId]);
    },
  });
}
