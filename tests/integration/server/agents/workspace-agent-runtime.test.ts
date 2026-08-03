import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

import type { AnalysisSnapshot } from "@/features/analysis/domain/contracts";
import { ManagerAgentRuntime } from "@/server/agents/manager/agent";
import type { AgentToolContext, WorkspaceToolName } from "@/server/agents/workspace-tool-executor";

describe("ManagerAgentRuntime challenge context", () => {
  it("binds review_target to the challenge referenced by the Agent run", async () => {
    const target = { moduleType: "risks", section: "items", itemId: "risk-1" } as const;
    const snapshot = challengeSnapshot(target);
    const executed: Array<{ name: WorkspaceToolName; context: AgentToolContext }> = [];
    let customTools: ToolDefinition[] = [];
    const runtime = new ManagerAgentRuntime(
      async (input) => {
        customTools = input.customTools;
        return managerSession(async () => {
          const tool = input.customTools.find((candidate) => candidate.name === "report_action");
          if (!tool) throw new Error("Missing report action tool");
          await tool.execute(
            "call-1",
            { action: "review_target" },
            undefined,
            undefined,
            undefined as never,
          );
        });
      },
      {
        async runExpert() {
          return { ok: false, code: "TOOL_NOT_ALLOWED" };
        },
        async runReportAction(context) {
          executed.push({ name: context.action, context });
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
        async appendEvent() { return 1; },
      },
    );
    const signal = new AbortController().signal;

    await runtime.run({ workspaceId: "workspace-1", agentRunId: "run-1", signal });

    expect(customTools.map((tool) => tool.name)).toEqual(["report_action"]);
    expect(executed).toEqual([{
      name: "review_target",
      context: {
        workspaceId: "workspace-1",
        agentRunId: "run-1",
        signal,
        action: "review_target",
        messageId: "message-1",
        target,
      },
    }]);
  });

  it("rejects a challenge run when the model stops before a completed review_target", async () => {
    const target = { moduleType: "risks", section: "items", itemId: "risk-1" } as const;
    const runtime = new ManagerAgentRuntime(
      async () => managerSession(),
      {
        async runExpert() { return { ok: true, summary: "unused" }; },
        async runReportAction() { return { ok: true, summary: "unused" }; },
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
        async getOwnedSnapshot() { return challengeSnapshot(target); },
        async listCompletedWorkspaceToolNames() { return []; },
        async listPersistedAgentToolArtifacts() { return []; },
        async appendEvent() { return 1; },
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

function managerSession(prompt: () => Promise<void> = async () => {}) {
  return {
    prompt,
    async waitForIdle() {},
    subscribe() { return () => {}; },
  };
}
