import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";

import { executeAgentRun } from "@/features/analysis/server/analysis-dispatcher";
import { PostgresAnalysisRepository } from "@/features/analysis/server/postgres-analysis-repository";
import { submitChallenge } from "@/features/conversation/server/submit-challenge";
import type { ExpertSuite } from "@/server/agents/expert-suite";
import { WorkspaceAgentRuntime } from "@/server/agents/workspace-agent-runtime";
import { WorkspaceToolExecutor } from "@/server/agents/workspace-tool-executor";
import { users } from "@/server/db/schema/auth";
import { createTestDb, migrateTestDb, truncateTestDb } from "../../../helpers/database";
import { createStubExpertSuite } from "../../../helpers/stub-expert-suite";

const db = createTestDb();
const repository = new PostgresAnalysisRepository(db);
const now = new Date("2026-08-02T00:00:00.000Z");
const target = { moduleType: "risks", section: "items", itemId: "risk-target" } as const;

describe("workspace Agent challenge", () => {
  beforeAll(() => migrateTestDb());
  beforeEach(() => truncateTestDb());
  afterAll(() => db.$client.end());

  it("queues a targeted Agent run, preserves the report until it completes, and revises only the selected item", async () => {
    const fixture = await createCompletedRiskReport();
    const dispatcher = { enqueue: vi.fn().mockResolvedValue({ runId: "queued-run" }) };
    const input = {
      userId: fixture.userId,
      jobId: fixture.workspaceId,
      target,
      content: "这项风险误读了原文，请重新核对。",
      idempotencyKey: "challenge-1",
    };

    const submitted = await submitChallenge(input, repository, dispatcher, () => now);

    expect(submitted).toMatchObject({ ok: true, created: true, status: "queued" });
    if (!submitted.ok) throw new Error("Expected queued challenge");
    expect(dispatcher.enqueue).toHaveBeenCalledWith({
      workspaceId: fixture.workspaceId,
      agentRunId: submitted.agentRunId,
      dispatchKey: `${submitted.agentRunId}:challenge`,
    });
    await expect(repository.getOwnedSnapshot(fixture.userId, fixture.workspaceId)).resolves.toMatchObject({
      currentVersion: 0,
      activeRun: { id: submitted.agentRunId, kind: "challenge", status: "queued" },
      modules: { risks: { version: 1, payload: { items: [fixture.targetRisk, fixture.siblingRisk] } } },
      messages: [expect.objectContaining({ id: submitted.messageId, role: "user", status: "queued" })],
      revisions: [],
    });
    await expect(submitChallenge({
      ...input,
      target: { ...target, itemId: fixture.siblingRisk.id },
      idempotencyKey: "challenge-2",
    }, repository, dispatcher, () => now)).resolves.toEqual({ ok: false, code: "RUN_BUSY" });

    const runtime = createChallengeRuntime();
    await expect(executeAgentRun({
      workspaceId: fixture.workspaceId,
      agentRunId: submitted.agentRunId,
      triggerRunId: "worker-1",
      signal: new AbortController().signal,
    }, runtime, repository, () => now)).resolves.toBe("completed");

    await expect(repository.getOwnedSnapshot(fixture.userId, fixture.workspaceId)).resolves.toMatchObject({
      currentVersion: 1,
      activeRun: { id: submitted.agentRunId, kind: "challenge", status: "completed" },
      modules: { risks: { version: 2, payload: { items: [fixture.siblingRisk] } } },
      messages: [
        expect.objectContaining({ id: submitted.messageId, role: "user", status: "completed" }),
        expect.objectContaining({ role: "agent", status: "completed" }),
      ],
      revisions: [expect.objectContaining({ triggeringMessageId: submitted.messageId })],
    });

    const followOn = await submitChallenge({
      ...input,
      target: { ...target, itemId: fixture.siblingRisk.id },
      idempotencyKey: "challenge-2",
    }, repository, dispatcher, () => new Date(now.getTime() + 1));
    expect(followOn).toMatchObject({ ok: true, created: true, status: "queued" });
    expect(followOn.ok && followOn.agentRunId).not.toBe(submitted.agentRunId);
  });

  it("leaves an incomplete review recoverable and creates a fresh run on idempotent replay", async () => {
    const fixture = await createCompletedRiskReport();
    const dispatcher = { enqueue: vi.fn().mockResolvedValue({ runId: "queued-run" }) };
    const input = {
      userId: fixture.userId,
      jobId: fixture.workspaceId,
      target,
      content: "这项风险误读了原文，请重新核对。",
      idempotencyKey: "challenge-recoverable",
    };
    const submitted = await submitChallenge(input, repository, dispatcher, () => now);
    if (!submitted.ok) throw new Error("Expected queued challenge");
    const runtime = createChallengeRuntime(createStubExpertSuite({
      async reviewTarget() {
        throw Object.assign(new Error("EXPERT_FAILED"), { code: "EXPERT_FAILED" });
      },
    }));

    await expect(executeAgentRun({
      workspaceId: fixture.workspaceId,
      agentRunId: submitted.agentRunId,
      triggerRunId: "worker-failed",
      signal: new AbortController().signal,
    }, runtime, repository, () => now)).resolves.toBe("recoverable");
    await expect(repository.getOwnedSnapshot(fixture.userId, fixture.workspaceId)).resolves.toMatchObject({
      currentVersion: 0,
      activeRun: { id: submitted.agentRunId, status: "recoverable" },
      modules: { risks: { version: 1, payload: { items: [fixture.targetRisk, fixture.siblingRisk] } } },
      messages: [expect.objectContaining({ id: submitted.messageId, status: "recoverable" })],
      revisions: [],
    });

    const replayed = await submitChallenge(
      input,
      repository,
      dispatcher,
      () => new Date(now.getTime() + 1),
    );
    expect(replayed).toMatchObject({ ok: true, created: false, status: "queued" });
    expect(replayed.ok && replayed.agentRunId).not.toBe(submitted.agentRunId);
    expect(dispatcher.enqueue).toHaveBeenLastCalledWith({
      workspaceId: fixture.workspaceId,
      agentRunId: replayed.ok ? replayed.agentRunId : "unreachable",
      dispatchKey: `${replayed.ok ? replayed.agentRunId : "unreachable"}:challenge`,
    });
  });

  it("rejects a new challenge until the baseline workspace is completed", async () => {
    const fixture = await createCompletedRiskReport();
    await repository.transitionJob(fixture.workspaceId, ["completed"], "interrupted", { now });
    const dispatcher = { enqueue: vi.fn() };

    await expect(submitChallenge({
      userId: fixture.userId,
      jobId: fixture.workspaceId,
      target,
      content: "请在基线完成后复核。",
      idempotencyKey: "challenge-before-baseline",
    }, repository, dispatcher, () => now)).resolves.toEqual({ ok: false, code: "RUN_BUSY" });
    expect(dispatcher.enqueue).not.toHaveBeenCalled();
  });

  it("makes a challenge recoverable when background dispatch fails", async () => {
    const fixture = await createCompletedRiskReport();
    const dispatcher = { enqueue: vi.fn().mockRejectedValue(new Error("queue unavailable")) };

    const submitted = await submitChallenge({
      userId: fixture.userId,
      jobId: fixture.workspaceId,
      target,
      content: "请重新核对。",
      idempotencyKey: "challenge-dispatch-failed",
    }, repository, dispatcher, () => now);

    expect(submitted).toMatchObject({ ok: true, status: "recoverable" });
    await expect(repository.getOwnedSnapshot(fixture.userId, fixture.workspaceId)).resolves.toMatchObject({
      status: "recoverable",
      activeRun: { kind: "challenge", status: "recoverable" },
      messages: [expect.objectContaining({ role: "user", status: "recoverable" })],
    });
  });

  it("commits a targeted result and its completed tool marker atomically", async () => {
    const fixture = await createCompletedRiskReport();
    const dispatcher = { enqueue: vi.fn().mockResolvedValue({ runId: "queued-run" }) };
    const submitted = await submitChallenge({
      userId: fixture.userId,
      jobId: fixture.workspaceId,
      target,
      content: "请重新核对。",
      idempotencyKey: "challenge-atomic-marker",
    }, repository, dispatcher, () => now);
    if (!submitted.ok) throw new Error("Expected queued challenge");
    await repository.claimAgentRun({
      workspaceId: fixture.workspaceId,
      userId: fixture.userId,
      agentRunId: submitted.agentRunId,
      now,
    });
    let separateFinishCalled = false;
    const repositoryWithCancellationWindow = new Proxy(repository, {
      get(targetRepository, property, receiver) {
        if (property === "finishAgentToolCall") {
          return async () => {
            separateFinishCalled = true;
            await targetRepository.requestAgentRunCancellation({
              workspaceId: fixture.workspaceId,
              userId: fixture.userId,
              agentRunId: submitted.agentRunId,
              now,
            });
            return false;
          };
        }
        const value = Reflect.get(targetRepository, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(targetRepository) : value;
      },
    });
    const executor = new WorkspaceToolExecutor(
      createStubExpertSuite(),
      repositoryWithCancellationWindow,
      () => now,
    );

    await expect(executor.execute("review_target", {
      workspaceId: fixture.workspaceId,
      agentRunId: submitted.agentRunId,
      messageId: submitted.messageId,
      target,
    })).resolves.toMatchObject({ ok: true });
    expect(separateFinishCalled).toBe(false);
    await expect(repository.getOwnedSnapshot(fixture.userId, fixture.workspaceId)).resolves.toMatchObject({
      status: "completed",
      activeRun: { status: "completed" },
      toolCalls: [expect.objectContaining({ status: "completed" })],
      messages: [
        expect.objectContaining({ role: "user", status: "completed" }),
        expect.objectContaining({ role: "agent", status: "completed" }),
      ],
    });
    await expect(repository.requestAgentRunCancellation({
      workspaceId: fixture.workspaceId,
      userId: fixture.userId,
      agentRunId: submitted.agentRunId,
      now: new Date(now.getTime() + 1),
    })).resolves.toBeNull();
  });
});

function createChallengeRuntime(
  experts: ExpertSuite = createStubExpertSuite(),
): WorkspaceAgentRuntime {
  let call = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      const review = call++ === 0;
      return {
        content: review
          ? [{
              type: "tool-call" as const,
              toolCallId: "review-target",
              toolName: "review_target",
              input: "{}",
            }]
          : [{ type: "text" as const, text: "done" }],
        finishReason: {
          unified: review ? ("tool-calls" as const) : ("stop" as const),
          raw: undefined,
        },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
      };
    },
  });
  return new WorkspaceAgentRuntime(
    model,
    new WorkspaceToolExecutor(experts, repository, () => now),
    repository,
  );
}

async function createCompletedRiskReport() {
  const [user] = await db
    .insert(users)
    .values({
      username: `reader_${randomUUID().slice(0, 8)}`,
      normalizedUsername: `reader_${randomUUID().slice(0, 8)}`,
      createdAt: now,
    })
    .returning({ id: users.id });
  const workspaceId = randomUUID();
  const reportId = randomUUID();
  await repository.createAnalysis({
    jobId: workspaceId,
    reportId,
    materialId: randomUUID(),
    userId: user.id,
    content: "30 岁以后考公是获得稳定人生的唯一选择。",
    detectedLanguage: "mixed",
    idempotencyKey: randomUUID(),
    configVersion: "baseline-v1",
    now,
  });
  const targetRisk = {
    id: target.itemId,
    type: "overgeneralization" as const,
    sourceMaterialQuote: "唯一选择。",
    explanation: "将单一选择扩大为唯一选择。",
    confidence: { score: 0.8, rationale: "存在绝对化表述" },
  };
  const siblingRisk = {
    id: "risk-sibling",
    type: "data_misleading" as const,
    sourceMaterialQuote: "稳定人生。",
    explanation: "材料没有量化稳定程度。",
    confidence: { score: 0.7, rationale: "缺少量化数据" },
  };
  await repository.saveModule({
    jobId: workspaceId,
    reportId,
    userId: user.id,
    moduleType: "risks",
    status: "completed",
    payload: { items: [targetRisk, siblingRisk] },
    expectedVersion: 0,
    nextVersion: 1,
    now,
  });
  await repository.transitionJob(workspaceId, ["queued"], "completed", { now });
  return { userId: user.id, workspaceId, targetRisk, siblingRisk };
}
