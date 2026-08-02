import { describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";

import type { AnalysisSnapshot } from "@/features/analysis/domain/contracts";
import { WorkspaceAgentRuntime } from "@/server/agents/workspace-agent-runtime";
import type { AgentToolContext, WorkspaceToolName } from "@/server/agents/workspace-tool-executor";

describe("WorkspaceAgentRuntime challenge context", () => {
  it("binds review_target to the challenge referenced by the Agent run", async () => {
    const target = { moduleType: "risks", section: "items", itemId: "risk-1" } as const;
    const snapshot = challengeSnapshot(target);
    const executed: Array<{ name: WorkspaceToolName; context: AgentToolContext }> = [];
    let generated = false;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        const content = generated
          ? [{ type: "text" as const, text: "done" }]
          : [{
              type: "tool-call" as const,
              toolCallId: "call-1",
              toolName: "review_target",
              input: "{}",
            }];
        const finishReason = generated ? "stop" as const : "tool-calls" as const;
        generated = true;
        return {
          content,
          finishReason: { unified: finishReason, raw: undefined },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
        };
      },
    });
    const runtime = new WorkspaceAgentRuntime(
      model,
      {
        async execute(name, context) {
          executed.push({ name, context });
          snapshot.toolCalls = [{
            id: "tool-call-1",
            agentRunId: "run-1",
            toolName: "review_target",
            status: "completed",
            summary: "复核完成。",
            errorCode: null,
            createdAt: "2026-08-02T00:00:00.000Z",
            completedAt: "2026-08-02T00:00:00.000Z",
          }];
          snapshot.messages = snapshot.messages.map((message) =>
            message.id === "message-1"
              ? { ...message, status: "completed" as const }
              : message
          );
          return { ok: true, summary: "复核完成。" };
        },
      },
      {
        async getJobForExecution() {
          return {
            jobId: "workspace-1",
            userId: "user-1",
            reportId: "report-1",
            material: "材料",
            detectedLanguage: "zh",
            status: "running",
            configVersion: "agent-v1",
          };
        },
        async getOwnedSnapshot() {
          return snapshot;
        },
        async listCompletedWorkspaceToolNames() {
          return [];
        },
        async listPersistedAgentToolArtifacts() {
          return [];
        },
      },
    );
    const signal = new AbortController().signal;

    await runtime.run({ workspaceId: "workspace-1", agentRunId: "run-1", signal });

    expect(model.doGenerateCalls[0]?.tools?.map((tool) => tool.name)).toEqual(["review_target"]);
    expect(executed).toEqual([{
      name: "review_target",
      context: {
        workspaceId: "workspace-1",
        agentRunId: "run-1",
        signal,
        kind: "challenge",
        completedTools: [],
        messageId: "message-1",
        target,
      },
    }]);
  });

  it("rejects a challenge run when the model stops before a completed review_target", async () => {
    const target = { moduleType: "risks", section: "items", itemId: "risk-1" } as const;
    const runtime = new WorkspaceAgentRuntime(
      new MockLanguageModelV4({
        doGenerate: async () => ({
          content: [{ type: "text" as const, text: "done" }],
          finishReason: { unified: "stop" as const, raw: undefined },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
        }),
      }),
      { async execute() { return { ok: true, summary: "unused" }; } },
      {
        async getJobForExecution() {
          return {
            jobId: "workspace-1",
            userId: "user-1",
            reportId: "report-1",
            material: "材料",
            detectedLanguage: "zh",
            status: "running",
            configVersion: "agent-v1",
          };
        },
        async getOwnedSnapshot() { return challengeSnapshot(target); },
        async listCompletedWorkspaceToolNames() { return []; },
        async listPersistedAgentToolArtifacts() { return []; },
      },
    );

    await expect(runtime.run({
      workspaceId: "workspace-1",
      agentRunId: "run-1",
      signal: new AbortController().signal,
    })).rejects.toThrow("CHALLENGE_INCOMPLETE");
  });
});

function challengeSnapshot(
  target: { moduleType: "risks"; section: "items"; itemId: string },
): AnalysisSnapshot {
  return {
    workspaceId: "workspace-1",
    reportId: "report-1",
    currentVersion: 0,
    status: "running",
    configVersion: "agent-v1",
    materialPreview: "材料",
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    lastEventId: 0,
    activeRun: {
      id: "run-1",
      workspaceId: "workspace-1",
      kind: "challenge",
      status: "running",
      configVersion: "agent-v1",
      messageId: "message-1",
      cancellationRequestedAt: null,
      startedAt: "2026-08-02T00:00:00.000Z",
      completedAt: null,
    },
    toolCalls: [],
    messages: [{
      id: "message-1",
      reportId: "report-1",
      role: "user",
      target,
      content: "请复核。",
      status: "queued",
      idempotencyKey: "challenge-1",
      createdAt: "2026-08-02T00:00:00.000Z",
    }],
    revisions: [],
    modules: Object.fromEntries(
      ["overview", "argument", "perspectives", "sources", "risks", "reflection"].map(
        (moduleType) => [moduleType, { status: "completed", version: 1 }],
      ),
    ) as AnalysisSnapshot["modules"],
  };
}
