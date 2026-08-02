import type { AnalysisEvent } from "@/features/analysis/server/analysis-repository";
import { getCurrentUser } from "@/features/auth/server/current-user";
import { getContainer } from "@/server/container";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

type AgUiEvent = Record<string, unknown> & { type: string };

const encoder = new TextEncoder();

export async function GET(request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });

  const { jobId } = await context.params;
  const repository = getContainer().analysisRepository;
  const snapshot = await repository.getOwnedSnapshot(user.id, jobId);
  if (!snapshot) return Response.json({ error: "分析不存在" }, { status: 404 });

  const after = readCursor(request);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let cursor = after;
      const deadline = Date.now() + 25_000;
      try {
        enqueue(controller, { type: "STATE_SNAPSHOT", snapshot });
        enqueue(controller, {
          type: "MESSAGES_SNAPSHOT",
          messages: snapshot.messages.map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
          })),
        });
        while (!request.signal.aborted && Date.now() < deadline) {
          const events = await repository.listEvents(user.id, jobId, cursor, 100);
          for (const event of events) {
            for (const agUiEvent of toAgUiEvents(event)) enqueue(controller, agUiEvent, event.id);
            cursor = event.id;
          }
          await new Promise((resolve) => setTimeout(resolve, events.length ? 100 : 1000));
        }
        controller.close();
      } catch (error) {
        if (request.signal.aborted) controller.close();
        else controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function enqueue(controller: ReadableStreamDefaultController<Uint8Array>, event: AgUiEvent, id?: number) {
  controller.enqueue(encoder.encode(`${id === undefined ? "" : `id: ${id}\n`}data: ${JSON.stringify(event)}\n\n`));
}

function toAgUiEvents(event: AnalysisEvent): AgUiEvent[] {
  const payload = event.payload;
  const timestamp = event.createdAt;
  switch (event.eventType) {
    case "agent.ui.run.started":
      return [{ type: "RUN_STARTED", timestamp, ...payload }];
    case "agent.ui.run.finished":
      return [{
        type: "RUN_FINISHED",
        timestamp,
        runId: stringValue(payload.runId),
        outcome: payload.outcome === "interrupt"
          ? { type: "interrupt", interrupts: [{ reason: "cancelled" }] }
          : { type: "success" },
      }];
    case "agent.ui.run.error":
      return [{ type: "RUN_ERROR", timestamp, ...payload }];
    case "agent.ui.step.started":
      return [{ type: "STEP_STARTED", timestamp, ...payload }];
    case "agent.ui.step.finished":
      return [{ type: "STEP_FINISHED", timestamp, ...payload }];
    case "agent.ui.text.started":
      return [{ type: "TEXT_MESSAGE_START", timestamp, ...payload }];
    case "agent.ui.text.delta":
      return [{
        type: "TEXT_MESSAGE_CONTENT",
        timestamp,
        messageId: stringValue(payload.messageId),
        delta: stringValue(payload.text),
      }];
    case "agent.ui.text.finished":
      return [{ type: "TEXT_MESSAGE_END", timestamp, ...payload }];
    case "agent.ui.tool.started":
      return [{ type: "TOOL_CALL_START", timestamp, ...payload }];
    case "agent.ui.tool.args":
      return [{
        type: "TOOL_CALL_ARGS",
        timestamp,
        toolCallId: stringValue(payload.toolCallId),
        delta: stringValue(payload.delta),
      }];
    case "agent.ui.tool.finished":
      return [{ type: "TOOL_CALL_END", timestamp, ...payload }];
    case "agent.ui.tool.result":
      return [{
        type: "TOOL_CALL_RESULT",
        timestamp,
        messageId: stringValue(payload.runId),
        toolCallId: stringValue(payload.toolCallId),
        role: "tool",
        content: payload.content,
      }];
    case "agent.ui.reasoning.summary":
      return reasoningEvents(payload, timestamp);
    case "agent.ui.activity":
      return [{
        type: "ACTIVITY_SNAPSHOT",
        timestamp,
        messageId: stringValue(payload.messageId),
        activityType: stringValue(payload.activityType),
        content: jsonValue(payload.content),
      }];
    case "agent.output.delta":
      return [{
        type: "TEXT_MESSAGE_CHUNK",
        timestamp,
        messageId: `${stringValue(payload.agentRunId)}:legacy-output`,
        role: "assistant",
        delta: stringValue(payload.text),
      }];
    case "agent.tool.updated":
      return [{
        type: "ACTIVITY_SNAPSHOT",
        timestamp,
        messageId: stringValue(payload.toolCallId),
        activityType: "workspace.tool",
        content: payload,
      }];
    default:
      return [{
        type: "CUSTOM",
        timestamp,
        name: `workspace.${event.eventType}`,
        value: payload,
      }];
  }
}

function reasoningEvents(payload: Record<string, unknown>, timestamp: string): AgUiEvent[] {
  const messageId = stringValue(payload.messageId);
  switch (payload.phase) {
    case "start":
      return [
        { type: "REASONING_START", timestamp, messageId },
        { type: "REASONING_MESSAGE_START", timestamp, messageId, role: "reasoning" },
      ];
    case "content":
      return [{ type: "REASONING_MESSAGE_CONTENT", timestamp, messageId, delta: stringValue(payload.text) }];
    case "end":
      return [
        { type: "REASONING_MESSAGE_END", timestamp, messageId },
        { type: "REASONING_END", timestamp, messageId },
      ];
    default:
      return [];
  }
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readCursor(request: Request): number {
  const raw = request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("after");
  const cursor = Number(raw ?? 0);
  return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
}
