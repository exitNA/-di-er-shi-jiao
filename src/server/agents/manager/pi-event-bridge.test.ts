import { describe, expect, it, vi } from "vitest";

import { bridgePiEvent } from "./pi-event-bridge";

describe("bridgePiEvent", () => {
  it("publishes a redacted AG-UI tool result", async () => {
    const appendEvent = vi.fn(async () => 1);

    await bridgePiEvent({
      type: "tool_execution_end",
      toolCallId: "tool-1",
      toolName: "delegate_expert",
      result: {
        content: [{ type: "text", text: "secret=credential" }],
        details: { secret: "credential" },
      },
      isError: false,
    }, { runId: "run-1", appendEvent });

    expect(appendEvent).toHaveBeenCalledWith("agent.ui.tool.result", {
      runId: "run-1",
      toolCallId: "tool-1",
      content: "已完成 delegate_expert。",
    });
    expect(JSON.stringify(appendEvent.mock.calls)).not.toContain("credential");
  });

  it("publishes only redacted assistant text deltas", async () => {
    const appendEvent = vi.fn(async () => 1);
    const context = { runId: "run-1", appendEvent };

    await bridgePiEvent({ type: "turn_start" }, context);
    await bridgePiEvent({
      type: "message_update",
      message: { role: "assistant", content: [] },
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta: "answer api_key=top-secret",
        partial: { role: "assistant", content: [] },
      },
    }, context);
    await bridgePiEvent({ type: "turn_end", message: { role: "user", content: "raw prompt" }, toolResults: [] }, context);

    expect(appendEvent.mock.calls).toEqual([
      ["agent.ui.text.started", { runId: "run-1", messageId: "run-1:assistant" }],
      ["agent.ui.text.delta", {
        runId: "run-1",
        messageId: "run-1:assistant",
        text: "answer api_key=[REDACTED]",
      }],
      ["agent.ui.text.finished", { runId: "run-1", messageId: "run-1:assistant" }],
    ]);
    expect(JSON.stringify(appendEvent.mock.calls)).not.toContain("raw prompt");
    expect(JSON.stringify(appendEvent.mock.calls)).not.toContain("top-secret");
  });

  it("redacts credentials split across streaming deltas", async () => {
    const appendEvent = vi.fn(async () => 1);
    const context = { runId: "run-1", appendEvent };

    await bridgePiEvent({ type: "turn_start" }, context);
    for (const delta of ["api_key=", "top-secret Authorization: Bearer actual-secret"]) {
      await bridgePiEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta },
      }, context);
    }
    await bridgePiEvent({ type: "turn_end" }, context);

    const serialized = JSON.stringify(appendEvent.mock.calls);
    expect(serialized).not.toContain("top-secret");
    expect(serialized).not.toContain("actual-secret");
    expect(serialized).toContain("[REDACTED]");
  });

  it("maps lifecycle events without publishing thinking or tool details", async () => {
    const appendEvent = vi.fn(async () => 1);
    const context = { runId: "run-1", appendEvent };

    await bridgePiEvent({ type: "agent_start", prompt: "internal prompt" }, context);
    await bridgePiEvent({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "private reasoning" },
    }, context);
    await bridgePiEvent({
      type: "tool_execution_start",
      toolCallId: "tool-1",
      toolName: "report_action",
      args: { secret: "credential" },
    }, context);
    await bridgePiEvent({
      type: "tool_execution_end",
      toolCallId: "tool-1",
      toolName: "report_action",
      result: { details: { secret: "credential" } },
      isError: true,
    }, context);
    await bridgePiEvent({ type: "agent_end", messages: [{ content: "internal prompt" }] }, context);
    expect(appendEvent).not.toHaveBeenCalledWith("agent.ui.step.finished", expect.anything());
    await bridgePiEvent({ type: "agent_settled" }, context);

    expect(appendEvent.mock.calls).toEqual([
      ["agent.ui.step.started", { runId: "run-1", stepName: "manager" }],
      ["agent.ui.tool.started", {
        runId: "run-1",
        toolCallId: "tool-1",
        toolCallName: "report_action",
      }],
      ["agent.ui.tool.result", {
        runId: "run-1",
        toolCallId: "tool-1",
        content: "未完成 report_action。",
      }],
      ["agent.ui.tool.finished", { runId: "run-1", toolCallId: "tool-1" }],
      ["agent.ui.step.finished", { runId: "run-1", stepName: "manager" }],
    ]);
    const serialized = JSON.stringify(appendEvent.mock.calls);
    expect(serialized).not.toContain("private reasoning");
    expect(serialized).not.toContain("internal prompt");
    expect(serialized).not.toContain("credential");
  });

  it("publishes only a fixed status for provider errors", async () => {
    const appendEvent = vi.fn(async () => 1);

    await bridgePiEvent({
      type: "message_update",
      assistantMessageEvent: {
        type: "error",
        reason: "error",
        error: { errorMessage: "Authorization: Bearer credential" },
      },
    }, { runId: "run-1", appendEvent });

    expect(appendEvent).toHaveBeenCalledWith("agent.ui.activity", {
      runId: "run-1",
      messageId: "run-1:status",
      activityType: "manager.status",
      content: { status: "failed" },
    });
    expect(JSON.stringify(appendEvent.mock.calls)).not.toContain("credential");
  });
});
