import type { NewAnalysisEvent } from "@/features/analysis/server/analysis-repository";

type AgentUiEventType = Extract<NewAnalysisEvent["eventType"], `agent.ui.${string}`>;

export type PiEventBridgeContext = {
  runId: string;
  appendEvent(eventType: AgentUiEventType, payload: Record<string, unknown>): Promise<unknown>;
};

const turnText = new WeakMap<PiEventBridgeContext, string>();

export async function bridgePiEvent(
  event: unknown,
  context: PiEventBridgeContext,
): Promise<void> {
  if (!isRecord(event) || typeof event.type !== "string") return;
  const messageId = `${context.runId}:assistant`;
  if (event.type === "agent_start") {
    await context.appendEvent("agent.ui.step.started", {
      runId: context.runId,
      stepName: "manager",
    });
  } else if (event.type === "agent_settled") {
    await context.appendEvent("agent.ui.step.finished", {
      runId: context.runId,
      stepName: "manager",
    });
  } else if (event.type === "turn_start") {
    turnText.set(context, "");
    await context.appendEvent("agent.ui.text.started", { runId: context.runId, messageId });
  } else if (event.type === "turn_end") {
    const text = redactPiText(turnText.get(context) ?? "").slice(0, 20_000);
    turnText.delete(context);
    if (text) {
      await context.appendEvent("agent.ui.text.delta", {
        runId: context.runId,
        messageId,
        text,
      });
    }
    await context.appendEvent("agent.ui.text.finished", { runId: context.runId, messageId });
  } else if (event.type === "message_update") {
    const update = event.assistantMessageEvent;
    if (!isRecord(update)) return;
    if (update.type === "text_delta" && typeof update.delta === "string") {
      turnText.set(context, `${turnText.get(context) ?? ""}${update.delta}`.slice(0, 20_000));
    } else if (update.type === "error") {
      await context.appendEvent("agent.ui.activity", {
        runId: context.runId,
        messageId: `${context.runId}:status`,
        activityType: "manager.status",
        content: { status: update.reason === "aborted" ? "interrupted" : "failed" },
      });
    }
  } else if (
    event.type === "tool_execution_start"
    && typeof event.toolCallId === "string"
    && typeof event.toolName === "string"
  ) {
    await context.appendEvent("agent.ui.tool.started", {
      runId: context.runId,
      toolCallId: event.toolCallId,
      toolCallName: event.toolName,
    });
  } else if (
    event.type === "tool_execution_end"
    && typeof event.toolCallId === "string"
    && typeof event.toolName === "string"
  ) {
    await context.appendEvent("agent.ui.tool.result", {
      runId: context.runId,
      toolCallId: event.toolCallId,
      content: event.isError
        ? `未完成 ${event.toolName}。`
        : `已完成 ${event.toolName}。`,
    });
    await context.appendEvent("agent.ui.tool.finished", {
      runId: context.runId,
      toolCallId: event.toolCallId,
    });
  }
}

export function redactPiText(value: string): string {
  return value
    .replace(/\b(?:sk|rk|pk)[_-][A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,"'}]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|authorization|token|password|secret)\s*[:=]\s*["']?)[^\s,"'}]+/gi, "$1[REDACTED]");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
