import { describe, expect, it } from "vitest";
import type { AnalysisSnapshot } from "@/features/analysis/domain/contracts";
import {
  workspaceAgentRunSchema,
  workspaceToolCallSchema,
} from "@/features/analysis/domain/workspace";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const agentRunId = "22222222-2222-4222-8222-222222222222";

describe("workspace runtime contracts", () => {
  it("exposes one active Agent run and safe expert summaries in a workspace snapshot", () => {
    const run = workspaceAgentRunSchema.parse({
      id: agentRunId,
      workspaceId,
      kind: "baseline",
      status: "running",
      configVersion: "agent-v1",
      cancellationRequestedAt: null,
      startedAt: "2026-08-02T00:00:00.000Z",
      completedAt: null,
    });
    const olderCall = workspaceToolCallSchema.parse({
      id: "33333333-3333-4333-8333-333333333333",
      agentRunId,
      toolName: "analyze_argument",
      status: "completed",
      summary: "已核对核心主张。",
      errorCode: null,
      createdAt: "2026-08-02T00:01:00.000Z",
      completedAt: "2026-08-02T00:01:30.000Z",
    });
    const newerCall = workspaceToolCallSchema.parse({
      id: "44444444-4444-4444-8444-444444444444",
      agentRunId,
      toolName: "review_risks",
      status: "running",
      summary: "正在审查潜在风险。",
      errorCode: null,
      createdAt: "2026-08-02T00:02:00.000Z",
      completedAt: null,
    });
    const snapshot: Pick<AnalysisSnapshot, "workspaceId" | "activeRun" | "toolCalls"> = {
      workspaceId,
      activeRun: run,
      toolCalls: [olderCall, newerCall],
    };

    expect(snapshot.activeRun?.status).toBe("running");
    expect(snapshot.toolCalls.map((call) => call.summary)).toEqual([
      "已核对核心主张。",
      "正在审查潜在风险。",
    ]);
  });

  it("rejects raw Agent inputs from a user-visible tool summary", () => {
    expect(() => workspaceToolCallSchema.parse({
      id: "33333333-3333-4333-8333-333333333333",
      agentRunId,
      toolName: "analyze_argument",
      status: "completed",
      summary: "已核对核心主张。",
      errorCode: null,
      createdAt: "2026-08-02T00:01:00.000Z",
      completedAt: "2026-08-02T00:01:30.000Z",
      rawPrompt: "不应返回给用户的原始提示词",
    })).toThrow();
  });

  it("limits user-visible tool summaries", () => {
    expect(() => workspaceToolCallSchema.parse({
      id: "33333333-3333-4333-8333-333333333333",
      agentRunId,
      toolName: "analyze_argument",
      status: "completed",
      summary: "过".repeat(501),
      errorCode: null,
      createdAt: "2026-08-02T00:01:00.000Z",
      completedAt: "2026-08-02T00:01:30.000Z",
    })).toThrow();
  });
});
