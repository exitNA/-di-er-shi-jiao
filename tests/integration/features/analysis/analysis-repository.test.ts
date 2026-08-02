import { randomUUID } from "node:crypto";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  resolveReportItemTarget,
  risksModuleSchema,
} from "@/features/analysis/domain/contracts";
import { PostgresAnalysisRepository } from "@/features/analysis/server/postgres-analysis-repository";
import type { CompleteRevision } from "@/features/analysis/server/analysis-repository";
import { agentRuns, analysisEvents, analysisJobs, reportModules, reportSources, reports } from "@/server/db/schema/analysis";
import { users } from "@/server/db/schema/auth";
import { createTestDb, migrateTestDb, truncateTestDb } from "../../../helpers/database";

const db = createTestDb();
const repository = new PostgresAnalysisRepository(db);
const now = new Date("2026-07-30T00:00:00.000Z");

async function createUser(username = `reader_${randomUUID().slice(0, 8)}`): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ username, normalizedUsername: username, createdAt: now })
    .returning({ id: users.id });
  return user.id;
}

async function createAnalysis(userId: string, idempotencyKey = randomUUID()) {
  const input = {
    jobId: randomUUID(),
    materialId: randomUUID(),
    reportId: randomUUID(),
    userId,
    content: "30 岁以后考公是获得稳定人生的唯一选择。",
    detectedLanguage: "mixed" as const,
    idempotencyKey,
    configVersion: "baseline-v1",
    now,
  };
  return { input, result: await repository.createAnalysis(input) };
}

async function seedPersistedRisk(reportId: string): Promise<void> {
  await db
    .update(reportModules)
    .set({
      payload: {
        items: [{
          id: "risk-1",
          type: "overgeneralization",
          sourceMaterialQuote: "唯一选择。",
          explanation: "把单一选项扩大成唯一选项。",
          confidence: { score: 0.8, rationale: "存在绝对化表达" },
        }],
      },
    })
    .where(and(
      eq(reportModules.reportId, reportId),
      eq(reportModules.moduleType, "risks"),
    ));
}

async function acquireRevision(
  input: { jobId: string; reportId: string },
  userId: string,
  messageId: string,
  leaseId: string,
): Promise<string> {
  const acquired = await repository.startRevision({
    jobId: input.jobId,
    reportId: input.reportId,
    userId,
    messageId,
    leaseId,
    leaseExpiresAt: new Date(now.getTime() + 30_000),
    now,
  });
  if (!acquired) throw new Error("Expected revision lease");
  return leaseId;
}

describe("PostgresAnalysisRepository", () => {
  beforeAll(() => migrateTestDb());
  beforeEach(() => truncateTestDb());
  afterAll(() => db.$client.end());

  it("returns the original job for the same user and idempotency key", async () => {
    const userId = await createUser();
    const first = await createAnalysis(userId, "same-request");
    const second = await createAnalysis(userId, "same-request");

    expect(first.result).toEqual({ jobId: first.input.jobId, created: true });
    expect(second.result).toEqual({ jobId: first.input.jobId, created: false });
  });

  it("allows a different user to reuse the same idempotency key", async () => {
    const first = await createAnalysis(await createUser(), "same-request");
    const second = await createAnalysis(await createUser(), "same-request");

    expect(second.result).toEqual({ jobId: second.input.jobId, created: true });
    expect(second.input.jobId).not.toBe(first.input.jobId);
  });

  it("returns null when a user reads another user's job", async () => {
    const owner = await createUser();
    const { input } = await createAnalysis(owner);

    await expect(repository.getOwnedSnapshot(await createUser(), input.jobId)).resolves.toBeNull();
  });

  it("lists only owned history newest first and keeps older reports reopenable", async () => {
    const owner = await createUser();
    const older = await createAnalysis(owner);
    const newer = await createAnalysis(owner);
    const foreign = await createAnalysis(await createUser());
    await db.update(analysisJobs).set({ createdAt: new Date("2026-07-28T00:00:00.000Z") })
      .where(eq(analysisJobs.id, older.input.jobId));
    await db.update(analysisJobs).set({ createdAt: new Date("2026-07-29T00:00:00.000Z") })
      .where(eq(analysisJobs.id, newer.input.jobId));
    await db.update(analysisJobs).set({ createdAt: new Date("2026-07-30T00:00:00.000Z") })
      .where(eq(analysisJobs.id, foreign.input.jobId));

    const history = await repository.listOwnedHistory(owner, 20);

    expect(history.map((item) => item.jobId)).toEqual([
      newer.input.jobId,
      older.input.jobId,
    ]);
    await expect(repository.getOwnedSnapshot(owner, older.input.jobId)).resolves
      .toMatchObject({ workspaceId: older.input.jobId });
  });

  it("maps persisted jobs to workspace snapshots before Agent runs are stored", async () => {
    const userId = await createUser();
    const { input } = await createAnalysis(userId);

    const snapshot = await repository.getOwnedSnapshot(userId, input.jobId);
    expect(snapshot).toMatchObject({
      workspaceId: input.jobId,
      activeRun: null,
      toolCalls: [],
    });
  });

  it("persists a cancelable Agent run and exposes only its safe tool summary", async () => {
    const userId = await createUser();
    const { input } = await createAnalysis(userId);
    const run = await repository.createAgentRun({
      workspaceId: input.jobId,
      userId,
      kind: "baseline",
      configVersion: "agent-v1",
      now,
    });
    if (!run) throw new Error("Expected owned Agent run");
    await expect(repository.claimAgentRun({
      workspaceId: input.jobId,
      userId,
      agentRunId: run.id,
      now,
    })).resolves.toBe(true);
    const otherUserId = await createUser();
    await expect(repository.appendAgentToolCall({
      workspaceId: input.jobId,
      userId: otherUserId,
      agentRunId: run.id,
      toolName: "analyze_argument",
      summary: "不应写入其他用户的工作空间。",
      now,
    })).resolves.toBeNull();
    const toolCall = await repository.appendAgentToolCall({
      workspaceId: input.jobId,
      userId,
      agentRunId: run.id,
      toolName: "analyze_argument",
      summary: "正在核对核心主张。",
      now,
    });
    if (!toolCall || !("id" in toolCall)) throw new Error("Expected owned tool call");
    const persistedArtifact = {
      kind: "baseline_module" as const,
      moduleType: "argument" as const,
      outputVersion: 1,
    };
    await expect(repository.saveAgentToolArtifact({
      workspaceId: input.jobId,
      userId,
      agentRunId: run.id,
      id: toolCall.id,
      artifact: persistedArtifact,
    })).resolves.toBe(true);

    const cancellation = await repository.requestAgentRunCancellation({
      workspaceId: input.jobId,
      userId,
      agentRunId: run.id,
      now,
    });
    expect(cancellation).toMatchObject({ triggerRunId: null, eventId: expect.any(Number) });
    await expect(repository.listEvents(userId, input.jobId, 0, 10)).resolves.toContainEqual(
      expect.objectContaining({ id: cancellation?.eventId, eventType: "agent.run.interrupted" }),
    );
    await expect(repository.appendAgentToolCall({
      workspaceId: input.jobId,
      userId,
      agentRunId: run.id,
      toolName: "review_risks",
      summary: "终止后不能新增工具调用。",
      now,
    })).resolves.toBeNull();
    await expect(repository.finishAgentToolCall({
      workspaceId: input.jobId,
      userId,
      agentRunId: run.id,
      id: toolCall.id,
      status: "completed",
      summary: "终止后不能完成工具调用。",
      now,
    })).resolves.toBe(false);
    await expect(repository.claimAgentRun({
      workspaceId: input.jobId,
      userId,
      agentRunId: run.id,
      now,
    })).resolves.toBe(false);
    await expect(repository.listCompletedWorkspaceToolNames({
      workspaceId: input.jobId,
      userId,
    })).resolves.toEqual([]);
    await expect(repository.listPersistedAgentToolArtifacts({
      workspaceId: input.jobId,
      userId,
      toolName: "analyze_argument",
    })).resolves.toEqual([persistedArtifact]);

    const snapshot = await repository.getOwnedSnapshot(userId, input.jobId);
    expect(snapshot).toMatchObject({
      status: "interrupted",
      activeRun: {
        id: run.id,
        workspaceId: input.jobId,
        status: "interrupted",
        cancellationRequestedAt: now.toISOString(),
      },
      toolCalls: [{
        id: toolCall.id,
        agentRunId: run.id,
        toolName: "analyze_argument",
        status: "running",
        summary: "正在核对核心主张。",
        errorCode: null,
        createdAt: now.toISOString(),
        completedAt: null,
      }],
    });
    expect(snapshot?.toolCalls[0]).not.toHaveProperty("rawPrompt");
    expect(snapshot?.toolCalls[0]).not.toHaveProperty("rawOutput");
  });

  it("emits workspace events when a tool starts and finishes", async () => {
    const userId = await createUser();
    const { input } = await createAnalysis(userId);
    const run = await repository.createAgentRun({
      workspaceId: input.jobId,
      userId,
      kind: "baseline",
      configVersion: "agent-v1",
      now,
    });
    if (!run) throw new Error("Expected Agent run");
    await repository.claimAgentRun({ workspaceId: input.jobId, userId, agentRunId: run.id, now });

    const call = await repository.appendAgentToolCall({
      workspaceId: input.jobId,
      userId,
      agentRunId: run.id,
      toolName: "analyze_argument",
      summary: "正在核对核心主张。",
      now,
    });
    if (!call || !("id" in call)) throw new Error("Expected tool call");
    expect(await repository.listEvents(userId, input.jobId, 0, 20)).toContainEqual(
      expect.objectContaining({
        eventType: "agent.tool.updated",
        payload: { agentRunId: run.id, toolCallId: call.id, status: "running" },
      }),
    );

    await repository.finishAgentToolCall({
      workspaceId: input.jobId,
      userId,
      agentRunId: run.id,
      id: call.id,
      status: "completed",
      summary: "核心主张已核对。",
      now,
    });
    expect(await repository.listEvents(userId, input.jobId, 0, 20)).toContainEqual(
      expect.objectContaining({
        eventType: "agent.tool.updated",
        payload: { agentRunId: run.id, toolCallId: call.id, status: "completed" },
      }),
    );
  });

  it("releases a running challenge lease when its Agent run is cancelled", async () => {
    const userId = await createUser();
    const { input } = await createAnalysis(userId);
    await seedPersistedRisk(input.reportId);
    await repository.transitionJob(input.jobId, ["queued"], "completed", { now });
    const challenge = await repository.createChallenge({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      target: { moduleType: "risks", section: "items", itemId: "risk-1" },
      content: "请重新核对。",
      idempotencyKey: "cancel-leased-challenge",
      now,
    });
    if (!challenge) throw new Error("Expected challenge");
    const run = await repository.createAgentRun({
      workspaceId: input.jobId,
      userId,
      kind: "challenge",
      messageId: challenge.messageId,
      configVersion: "agent-v1",
      now,
    });
    if (!run) throw new Error("Expected challenge run");
    await repository.claimAgentRun({ workspaceId: input.jobId, userId, agentRunId: run.id, now });
    await repository.startRevision({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      messageId: challenge.messageId,
      leaseId: "old-worker",
      leaseExpiresAt: new Date(now.getTime() + 30_000),
      now,
    });

    await repository.requestAgentRunCancellation({
      workspaceId: input.jobId,
      userId,
      agentRunId: run.id,
      now: new Date(now.getTime() + 1),
    });
    await expect(repository.getOwnedSnapshot(userId, input.jobId)).resolves.toMatchObject({
      activeRun: { status: "interrupted" },
      messages: [expect.objectContaining({ id: challenge.messageId, status: "recoverable" })],
    });
    const resumed = await repository.createAgentRun({
      workspaceId: input.jobId,
      userId,
      kind: "challenge",
      messageId: challenge.messageId,
      configVersion: "agent-v1",
      previousAgentRunId: run.id,
      now: new Date(now.getTime() + 2),
    });
    if (!resumed) throw new Error("Expected resumed challenge run");
    await repository.claimAgentRun({
      workspaceId: input.jobId,
      userId,
      agentRunId: resumed.id,
      now: new Date(now.getTime() + 2),
    });
    await expect(repository.startRevision({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      messageId: challenge.messageId,
      leaseId: "new-worker",
      leaseExpiresAt: new Date(now.getTime() + 30_000),
      now: new Date(now.getTime() + 2),
    })).resolves.toBe(true);
  });

  it("cancels a queued follow-on run in an interrupted workspace", async () => {
    const userId = await createUser();
    const { input } = await createAnalysis(userId);
    const firstRun = await repository.createAgentRun({
      workspaceId: input.jobId,
      userId,
      kind: "baseline",
      configVersion: "agent-v1",
      now,
    });
    if (!firstRun) throw new Error("Expected owned Agent run");
    await repository.requestAgentRunCancellation({
      workspaceId: input.jobId,
      userId,
      agentRunId: firstRun.id,
      now,
    });
    const followOnRun = await repository.createAgentRun({
      workspaceId: input.jobId,
      userId,
      kind: "baseline",
      configVersion: "agent-v1",
      previousAgentRunId: firstRun.id,
      now,
    });
    if (!followOnRun) throw new Error("Expected owned follow-on Agent run");

    await expect(repository.requestAgentRunCancellation({
      workspaceId: input.jobId,
      userId,
      agentRunId: followOnRun.id,
      now,
    })).resolves.toMatchObject({ eventId: expect.any(Number) });

    const [cancelledRun] = await db
      .select({ status: agentRuns.status })
      .from(agentRuns)
      .where(eq(agentRuns.id, followOnRun.id));
    expect(cancelledRun.status).toBe("interrupted");
  });

  it("rejects durability writes from a cancelled Agent run after resume", async () => {
    const userId = await createUser();
    const { input } = await createAnalysis(userId);
    const oldRun = await repository.createAgentRun({
      workspaceId: input.jobId,
      userId,
      kind: "baseline",
      configVersion: "agent-v1",
      now,
    });
    if (!oldRun) throw new Error("Expected original Agent run");
    await repository.claimAgentRun({ workspaceId: input.jobId, userId, agentRunId: oldRun.id, now });
    const oldToolCall = await repository.appendAgentToolCall({
      workspaceId: input.jobId,
      userId,
      agentRunId: oldRun.id,
      toolName: "analyze_risks",
      summary: "旧运行正在分析风险。",
      now,
    });
    if (!oldToolCall || !("id" in oldToolCall)) throw new Error("Expected original tool call");
    await repository.requestAgentRunCancellation({
      workspaceId: input.jobId,
      userId,
      agentRunId: oldRun.id,
      now: new Date(now.getTime() + 1),
    });
    const resumedRun = await repository.createAgentRun({
      workspaceId: input.jobId,
      userId,
      kind: "baseline",
      configVersion: "agent-v1",
      previousAgentRunId: oldRun.id,
      now: new Date(now.getTime() + 2),
    });
    if (!resumedRun) throw new Error("Expected resumed Agent run");
    await repository.claimAgentRun({
      workspaceId: input.jobId,
      userId,
      agentRunId: resumedRun.id,
      now: new Date(now.getTime() + 2),
    });

    await repository.saveModule({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      agentRunId: oldRun.id,
      moduleType: "risks",
      status: "completed",
      payload: {
        items: [{
          id: "late-risk",
          type: "overgeneralization",
          sourceMaterialQuote: "唯一选择。",
          explanation: "旧运行不应写回。",
          confidence: { score: 0.8, rationale: "旧运行已被取消" },
        }],
      },
      expectedVersion: 0,
      nextVersion: 1,
      now: new Date(now.getTime() + 3),
    });
    await repository.saveSourcesModule({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      agentRunId: oldRun.id,
      moduleType: "sources",
      status: "completed",
      payload: { sources: [] },
      expectedVersion: 0,
      nextVersion: 1,
      now: new Date(now.getTime() + 3),
    });
    await expect(repository.saveAgentToolArtifact({
      workspaceId: input.jobId,
      userId,
      agentRunId: oldRun.id,
      id: oldToolCall.id,
      artifact: {
        kind: "baseline_module",
        moduleType: "risks",
        outputVersion: 1,
      },
    })).resolves.toBe(false);

    await expect(repository.getOwnedSnapshot(userId, input.jobId)).resolves.toMatchObject({
      activeRun: { id: resumedRun.id, status: "running" },
      modules: {
        risks: { status: "queued", version: 0 },
        sources: { status: "queued", version: 0 },
      },
    });
  });

  it("creates only one follow-on run for the latest interrupted run", async () => {
    const userId = await createUser();
    const { input } = await createAnalysis(userId);
    const interrupted = await repository.createAgentRun({
      workspaceId: input.jobId,
      userId,
      kind: "baseline",
      configVersion: "agent-v1",
      now,
    });
    if (!interrupted) throw new Error("Expected owned Agent run");
    await repository.requestAgentRunCancellation({
      workspaceId: input.jobId,
      userId,
      agentRunId: interrupted.id,
      now,
    });
    const resumedAt = new Date(now.getTime() + 1);

    const runs = await Promise.all([
      repository.createAgentRun({
        workspaceId: input.jobId,
        userId,
        kind: "baseline",
        configVersion: "agent-v1",
        previousAgentRunId: interrupted.id,
        now: resumedAt,
      }),
      repository.createAgentRun({
        workspaceId: input.jobId,
        userId,
        kind: "baseline",
        configVersion: "agent-v1",
        previousAgentRunId: interrupted.id,
        now: resumedAt,
      }),
    ]);

    expect(runs.filter(Boolean)).toHaveLength(1);
  });

  it("keeps the follow-on run active when a stale cancellation loses to resume", async () => {
    const userId = await createUser();
    const { input } = await createAnalysis(userId);
    const recoverable = await repository.createAgentRun({
      workspaceId: input.jobId,
      userId,
      kind: "baseline",
      configVersion: "agent-v1",
      now,
    });
    if (!recoverable) throw new Error("Expected owned Agent run");
    await repository.claimAgentRun({
      workspaceId: input.jobId,
      userId,
      agentRunId: recoverable.id,
      now,
    });
    await repository.finishAgentRun({
      workspaceId: input.jobId,
      userId,
      agentRunId: recoverable.id,
      status: "recoverable",
      now,
    });
    const resumed = await repository.createAgentRun({
      workspaceId: input.jobId,
      userId,
      kind: "baseline",
      configVersion: "agent-v1",
      previousAgentRunId: recoverable.id,
      now: new Date(now.getTime() + 1),
    });
    if (!resumed) throw new Error("Expected follow-on Agent run");

    await expect(repository.requestAgentRunCancellation({
      workspaceId: input.jobId,
      userId,
      agentRunId: recoverable.id,
      now: new Date(now.getTime() + 2),
    })).resolves.toBeNull();
    await expect(repository.getOwnedSnapshot(userId, input.jobId)).resolves.toMatchObject({
      status: "recoverable",
      activeRun: { id: resumed.id, status: "queued" },
    });
  });

  it("claims and finishes an owned Agent run with compare-and-swap status checks", async () => {
    const userId = await createUser();
    const { input } = await createAnalysis(userId);
    const run = await repository.createAgentRun({
      workspaceId: input.jobId,
      userId,
      kind: "baseline",
      configVersion: "agent-v1",
      now,
    });
    if (!run) throw new Error("Expected owned Agent run");
    const otherUserId = await createUser();

    await expect(repository.requestAgentRunCancellation({
      workspaceId: input.jobId,
      userId: otherUserId,
      agentRunId: run.id,
      now,
    })).resolves.toBeNull();

    await expect(repository.claimAgentRun({
      workspaceId: input.jobId,
      userId,
      agentRunId: run.id,
      triggerRunId: "trigger-run-1",
      now,
    })).resolves.toBe(true);
    await expect(repository.claimAgentRun({
      workspaceId: input.jobId,
      userId,
      agentRunId: run.id,
      triggerRunId: "trigger-run-2",
      now,
    })).resolves.toBe(false);

    const toolCall = await repository.appendAgentToolCall({
      workspaceId: input.jobId,
      userId,
      agentRunId: run.id,
      toolName: "analyze_argument",
      summary: "正在核对核心主张。",
      now,
    });
    if (!toolCall || !("id" in toolCall)) throw new Error("Expected owned tool call");
    await expect(repository.finishAgentToolCall({
      workspaceId: input.jobId,
      userId: otherUserId,
      agentRunId: run.id,
      id: toolCall.id,
      status: "completed",
      summary: "其他用户不能结束工具调用。",
      now,
    })).resolves.toBe(false);
    await expect(repository.finishAgentToolCall({
      workspaceId: input.jobId,
      userId,
      agentRunId: run.id,
      id: toolCall.id,
      status: "completed",
      summary: "已核对核心主张。",
      now,
    })).resolves.toBe(true);
    await expect(repository.finishAgentRun({
      workspaceId: input.jobId,
      userId,
      agentRunId: run.id,
      status: "completed",
      now,
    })).resolves.toBe(true);
    await expect(repository.claimAgentRun({
      workspaceId: input.jobId,
      userId,
      agentRunId: run.id,
      now,
    })).resolves.toBe(false);

    await expect(repository.getOwnedSnapshot(userId, input.jobId)).resolves.toMatchObject({
      status: "completed",
      activeRun: {
        id: run.id,
        status: "completed",
        startedAt: now.toISOString(),
        completedAt: now.toISOString(),
      },
      toolCalls: [expect.objectContaining({
        id: toolCall.id,
        status: "completed",
        summary: "已核对核心主张。",
        completedAt: now.toISOString(),
      })],
    });
  });

  it("does not expose a saved challenge message to another user", async () => {
    const owner = await createUser();
    const { input } = await createAnalysis(owner);
    await repository.createChallenge({
      jobId: input.jobId,
      reportId: input.reportId,
      userId: owner,
      target: { moduleType: "risks", section: "items", itemId: "risk-1" },
      content: "这个风险是否误读了原文？",
      idempotencyKey: "challenge-1",
      now,
    });

    const ownerSnapshot = await repository.getOwnedSnapshot(owner, input.jobId);
    await expect(repository.getOwnedSnapshot(await createUser(), input.jobId)).resolves.toBeNull();
    expect(ownerSnapshot?.messages).toEqual([
      expect.objectContaining({ idempotencyKey: "challenge-1" }),
    ]);
  });

  it("returns the original challenge message for the same idempotency key", async () => {
    const userId = await createUser();
    const { input } = await createAnalysis(userId);
    const challenge = {
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      target: { moduleType: "risks" as const, section: "items", itemId: "risk-1" },
      content: "这个风险是否误读了原文？",
      idempotencyKey: "challenge-1",
      now,
    };

    const first = await repository.createChallenge(challenge);
    const second = await repository.createChallenge(challenge);

    expect(first).toEqual({ messageId: first.messageId, created: true });
    expect(second).toEqual({ messageId: first.messageId, created: false });
  });

  it("atomically acquires one revision worker and allows recoverable work to resume", async () => {
    const userId = await createUser();
    const { input } = await createAnalysis(userId);
    const challenge = await repository.createChallenge({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      target: { moduleType: "risks", section: "items", itemId: "risk-1" },
      content: "这个风险是否误读了原文？",
      idempotencyKey: "challenge-lock",
      now,
    });
    if (!challenge) throw new Error("Expected owned challenge");
    const acquire = {
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      messageId: challenge.messageId,
      now,
    };
    const leaseExpiresAt = new Date(now.getTime() + 30_000);

    const acquired = await Promise.all([
      repository.startRevision({ ...acquire, leaseId: "worker-1", leaseExpiresAt }),
      repository.startRevision({ ...acquire, leaseId: "worker-2", leaseExpiresAt }),
    ]);

    const winningLeaseId = acquired[0] ? "worker-1" : "worker-2";
    expect(acquired.sort()).toEqual([false, true]);
    await expect(repository.recoverRevision({
      ...acquire,
      leaseId: winningLeaseId,
    })).resolves.toBe(true);
    await expect(repository.startRevision({
      ...acquire,
      leaseId: "worker-3",
      leaseExpiresAt,
    })).resolves.toBe(true);
    await expect(repository.getOwnedSnapshot(userId, input.jobId)).resolves.toMatchObject({
      messages: [expect.objectContaining({ status: "running" })],
    });
  });

  it("takes over an expired revision lease and fences the disappeared worker", async () => {
    const userId = await createUser();
    const { input } = await createAnalysis(userId);
    const challenge = await repository.createChallenge({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      target: { moduleType: "risks", section: "items", itemId: "risk-1" },
      content: "这个风险是否误读了原文？",
      idempotencyKey: "challenge-expired-lease",
      now,
    });
    if (!challenge) throw new Error("Expected owned challenge");
    const ownership = {
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      messageId: challenge.messageId,
    };
    const leaseExpiresAt = new Date(now.getTime() + 1_000);

    await expect(repository.startRevision({
      ...ownership,
      leaseId: "worker-1",
      leaseExpiresAt,
      now,
    })).resolves.toBe(true);
    await expect(repository.startRevision({
      ...ownership,
      leaseId: "worker-2",
      leaseExpiresAt: new Date(leaseExpiresAt.getTime() + 1_000),
      now: new Date(leaseExpiresAt.getTime() - 1),
    })).resolves.toBe(false);
    await expect(repository.startRevision({
      ...ownership,
      leaseId: "worker-2",
      leaseExpiresAt: new Date(leaseExpiresAt.getTime() + 1_000),
      now: leaseExpiresAt,
    })).resolves.toBe(true);
    await expect(repository.recoverRevision({
      ...ownership,
      leaseId: "worker-1",
      now: leaseExpiresAt,
    })).resolves.toBe(false);
    await expect(repository.recoverRevision({
      ...ownership,
      leaseId: "worker-2",
      now: leaseExpiresAt,
    })).resolves.toBe(true);
  });

  it("atomically completes an Agent response without changing the report", async () => {
    const userId = await createUser();
    const { input } = await createAnalysis(userId);
    await seedPersistedRisk(input.reportId);
    const target = { moduleType: "risks" as const, section: "items", itemId: "risk-1" };
    const challenge = await repository.createChallenge({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      target,
      content: "这个风险是否误读了原文？",
      idempotencyKey: "challenge-response-only",
      now,
    });
    if (!challenge) throw new Error("Expected owned challenge");
    const ownership = {
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      messageId: challenge.messageId,
      leaseId: "response-worker",
      now,
    };
    await repository.startRevision({
      ...ownership,
      leaseExpiresAt: new Date(now.getTime() + 30_000),
    });

    await expect(repository.completeRevisionResponse({
      ...ownership,
      agentContent: "复核后无需修订。",
      expectedReportVersion: 0,
      target,
      expectedModuleVersion: 0,
    })).resolves.toBe(true);

    await expect(repository.getOwnedSnapshot(userId, input.jobId)).resolves.toMatchObject({
      currentVersion: 0,
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "user", status: "completed" }),
        expect.objectContaining({ role: "agent", content: "复核后无需修订。" }),
      ]),
      revisions: [],
    });
  });

  it("rejects a response-only completion when the reviewed report version is stale", async () => {
    const userId = await createUser();
    const { input } = await createAnalysis(userId);
    await seedPersistedRisk(input.reportId);
    const target = { moduleType: "risks" as const, section: "items", itemId: "risk-1" };
    const challenge = await repository.createChallenge({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      target,
      content: "这个风险是否误读了原文？",
      idempotencyKey: "challenge-stale-response",
      now,
    });
    if (!challenge) throw new Error("Expected owned challenge");
    const ownership = {
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      messageId: challenge.messageId,
      leaseId: "response-worker",
      now,
    };
    await repository.startRevision({
      ...ownership,
      leaseExpiresAt: new Date(now.getTime() + 30_000),
    });
    await db
      .update(reports)
      .set({ currentVersion: 1 })
      .where(eq(reports.id, input.reportId));

    await expect(repository.completeRevisionResponse({
      ...ownership,
      agentContent: "基于旧报告的回答不应保存。",
      expectedReportVersion: 0,
      target,
      expectedModuleVersion: 0,
    })).resolves.toBe(false);
    await expect(repository.getOwnedSnapshot(userId, input.jobId)).resolves.toMatchObject({
      currentVersion: 1,
      messages: [expect.objectContaining({ role: "user", status: "recoverable" })],
    });
  });

  it("serializes response-only CAS against an uncommitted report revision", async () => {
    const userId = await createUser();
    const { input } = await createAnalysis(userId);
    await seedPersistedRisk(input.reportId);
    const target = { moduleType: "risks" as const, section: "items", itemId: "risk-1" };
    const challenge = await repository.createChallenge({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      target,
      content: "这个风险是否误读了原文？",
      idempotencyKey: "challenge-concurrent-response",
      now,
    });
    if (!challenge) throw new Error("Expected owned challenge");
    const leaseId = await acquireRevision(input, userId, challenge.messageId, "concurrent-response-worker");
    let reportUpdated!: () => void;
    let allowCommit!: () => void;
    const updated = new Promise<void>((resolve) => { reportUpdated = resolve; });
    const commit = new Promise<void>((resolve) => { allowCommit = resolve; });
    const concurrentRevision = db.transaction(async (tx) => {
      await tx
        .update(reports)
        .set({ currentVersion: 1 })
        .where(eq(reports.id, input.reportId));
      reportUpdated();
      await commit;
    });
    await updated;

    const completion = repository.completeRevisionResponse({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      messageId: challenge.messageId,
      leaseId,
      agentContent: "基于旧报告的回答不应保存。",
      expectedReportVersion: 0,
      target,
      expectedModuleVersion: 0,
      now,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    allowCommit();
    await concurrentRevision;

    await expect(completion).resolves.toBe(false);
    await expect(repository.getOwnedSnapshot(userId, input.jobId)).resolves.toMatchObject({
      currentVersion: 1,
      messages: [expect.objectContaining({ role: "user", status: "recoverable" })],
    });
  });

  it("does not overwrite a newer report revision with an outdated version", async () => {
    const userId = await createUser();
    const { input } = await createAnalysis(userId);
    await seedPersistedRisk(input.reportId);
    const challenge = await repository.createChallenge({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      target: { moduleType: "risks", section: "items", itemId: "risk-1" },
      content: "这个风险是否误读了原文？",
      idempotencyKey: "challenge-1",
      now,
    });
    const staleChallenge = await repository.createChallenge({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      target: { moduleType: "risks", section: "items", itemId: "risk-1" },
      content: "并发复核同一风险。",
      idempotencyKey: "challenge-2",
      now,
    });
    if (!challenge || !staleChallenge) throw new Error("Expected owned challenges");
    const firstLeaseId = await acquireRevision(input, userId, challenge.messageId, "first-worker");
    const staleLeaseId = await acquireRevision(input, userId, staleChallenge.messageId, "stale-worker");

    const first = await repository.completeRevision({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      messageId: challenge.messageId,
      leaseId: firstLeaseId,
      agentContent: "复核后已修订。",
      expectedReportVersion: 0,
      module: {
        moduleType: "risks",
        payload: { items: [] },
        expectedVersion: 0,
        nextVersion: 1,
      },
      changes: [
        {
          target: { moduleType: "risks", section: "items", itemId: "risk-1" },
          reason: "原结论超出原文证据。",
          newEvidenceSourceIds: [],
          summary: "删除该风险。",
        },
      ],
      now,
    });
    const recovery = await repository.recoverRevision({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      messageId: challenge.messageId,
      leaseId: firstLeaseId,
      now,
    });
    const stale = await repository.completeRevision({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      messageId: staleChallenge.messageId,
      leaseId: staleLeaseId,
      agentContent: "这次过期修订不应覆盖报告。",
      expectedReportVersion: 0,
      module: {
        moduleType: "risks",
        payload: { items: [] },
        expectedVersion: 0,
        nextVersion: 1,
      },
      changes: [
        {
          target: { moduleType: "risks", section: "items", itemId: "risk-1" },
          reason: "过期复核。",
          newEvidenceSourceIds: [],
          summary: "不应写入。",
        },
      ],
      now,
    });

    const snapshot = await repository.getOwnedSnapshot(userId, input.jobId);
    expect(first.completed).toBe(true);
    expect(recovery).toBe(false);
    expect(stale.completed).toBe(false);
    expect(snapshot).toMatchObject({ currentVersion: 1 });
    expect(snapshot?.revisions).toHaveLength(1);
    expect(snapshot?.messages).toHaveLength(3);
    expect(snapshot?.messages.filter((message) => message.role === "user").map((message) => message.status).sort()).toEqual([
      "completed",
      "recoverable",
    ]);
  });

  it("rejects a revision whose module or change target does not match the challenged item", async () => {
    const userId = await createUser();
    const { input } = await createAnalysis(userId);
    const challenge = await repository.createChallenge({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      target: { moduleType: "risks", section: "items", itemId: "risk-1" },
      content: "这个风险是否误读了原文？",
      idempotencyKey: "challenge-1",
      now,
    });
    if (!challenge) throw new Error("Expected owned challenge");
    const leaseId = await acquireRevision(input, userId, challenge.messageId, "mismatched-target-worker");

    const result = await repository.completeRevision({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      messageId: challenge.messageId,
      leaseId,
      agentContent: "不应保存。",
      expectedReportVersion: 0,
      module: {
        moduleType: "risks",
        payload: { items: [] },
        expectedVersion: 0,
        nextVersion: 1,
      },
      changes: [
        {
          target: { moduleType: "risks", section: "items", itemId: "risk-2" },
          reason: "目标不一致。",
          newEvidenceSourceIds: [],
          summary: "不应写入。",
        },
      ],
      now,
    });

    const snapshot = await repository.getOwnedSnapshot(userId, input.jobId);
    expect(result).toEqual({ completed: false });
    expect(snapshot).toMatchObject({ currentVersion: 0, revisions: [] });
    expect(snapshot?.messages).toEqual([expect.objectContaining({ status: "running" })]);
  });

  it("rejects a module replacement that changes outside the challenged target", async () => {
    const userId = await createUser();
    const { input } = await createAnalysis(userId);
    const targetRisk = {
      id: "risk-1",
      type: "overgeneralization" as const,
      sourceMaterialQuote: "唯一选择。",
      explanation: "把单一选项扩大成唯一选项。",
      confidence: { score: 0.8, rationale: "存在绝对化表达" },
    };
    const siblingRisk = {
      id: "risk-2",
      type: "data_misleading" as const,
      sourceMaterialQuote: "稳定人生。",
      explanation: "没有数据支持稳定程度。",
      confidence: { score: 0.7, rationale: "缺少量化数据" },
    };
    await repository.saveModule({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      moduleType: "risks",
      status: "completed",
      payload: { items: [targetRisk, siblingRisk] },
      expectedVersion: 0,
      nextVersion: 1,
      now,
    });
    const challenge = await repository.createChallenge({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      target: { moduleType: "risks", section: "items", itemId: targetRisk.id },
      content: "只复核当前风险。",
      idempotencyKey: "challenge-outside-target",
      now,
    });
    if (!challenge) throw new Error("Expected owned challenge");
    const leaseId = await acquireRevision(input, userId, challenge.messageId, "outside-target-worker");

    const result = await repository.completeRevision({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      messageId: challenge.messageId,
      leaseId,
      agentContent: "不应保存越界修订。",
      expectedReportVersion: 0,
      module: {
        moduleType: "risks",
        payload: { items: [{ ...siblingRisk, explanation: "被 Agent 静默改写。" }] },
        expectedVersion: 1,
        nextVersion: 2,
      },
      changes: [{
        target: { moduleType: "risks", section: "items", itemId: targetRisk.id },
        reason: "删除目标风险。",
        newEvidenceSourceIds: [],
        summary: "越界修改了相邻风险。",
      }],
      now,
    });

    const snapshot = await repository.getOwnedSnapshot(userId, input.jobId);
    expect(result).toEqual({ completed: false });
    expect(snapshot).toMatchObject({
      currentVersion: 0,
      revisions: [],
      modules: { risks: { version: 1, payload: { items: [targetRisk, siblingRisk] } } },
    });

    const targetOnlyResult = await repository.completeRevision({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      messageId: challenge.messageId,
      leaseId,
      agentContent: "只保存目标修订。",
      expectedReportVersion: 0,
      module: {
        moduleType: "risks",
        payload: { items: [siblingRisk] },
        expectedVersion: 1,
        nextVersion: 2,
      },
      changes: [{
        target: { moduleType: "risks", section: "items", itemId: targetRisk.id },
        reason: "删除目标风险。",
        newEvidenceSourceIds: [],
        summary: "仅删除目标风险。",
      }],
      now,
    });
    const completedSnapshot = await repository.getOwnedSnapshot(userId, input.jobId);
    expect(targetOnlyResult.completed).toBe(true);
    expect(completedSnapshot).toMatchObject({
      currentVersion: 1,
      revisions: [{
        changes: [{
          target: { moduleType: "risks", section: "items", itemId: targetRisk.id },
          summary: "仅删除目标风险。",
        }],
      }],
      modules: { risks: { version: 2, payload: { items: [siblingRisk] } } },
    });
  });

  it("rejects a revision payload that does not match its module type", async () => {
    const userId = await createUser();
    const { input } = await createAnalysis(userId);
    const challenge = await repository.createChallenge({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      target: { moduleType: "risks", section: "items", itemId: "risk-1" },
      content: "这个风险是否误读了原文？",
      idempotencyKey: "challenge-1",
      now,
    });
    if (!challenge) throw new Error("Expected owned challenge");
    const leaseId = await acquireRevision(input, userId, challenge.messageId, "invalid-payload-worker");
    const invalidInput: unknown = {
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      messageId: challenge.messageId,
      leaseId,
      agentContent: "不应保存。",
      expectedReportVersion: 0,
      module: {
        moduleType: "risks",
        payload: { question: "错误模块", whyItMatters: "类型不匹配。" },
        expectedVersion: 0,
        nextVersion: 1,
      },
      changes: [
        {
          target: { moduleType: "risks", section: "items", itemId: "risk-1" },
          reason: "测试输入。",
          newEvidenceSourceIds: [],
          summary: "不应写入。",
        },
      ],
      now,
    };

    await expect(repository.completeRevision(invalidInput as CompleteRevision)).resolves.toEqual({
      completed: false,
    });
    await expect(repository.getOwnedSnapshot(userId, input.jobId)).resolves.toMatchObject({
      currentVersion: 0,
      revisions: [],
    });
  });

  it("writes module snapshot and event atomically", async () => {
    const userId = await createUser();
    const { input } = await createAnalysis(userId);

    await repository.saveModule({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      moduleType: "reflection",
      status: "completed",
      payload: { question: "还需要什么证据？", whyItMatters: "验证结论。" },
      expectedVersion: 0,
      nextVersion: 1,
      now,
    });

    const snapshot = await repository.getOwnedSnapshot(userId, input.jobId);
    const [event] = await db.select().from(analysisEvents);
    expect(snapshot?.modules.reflection).toMatchObject({ status: "completed", version: 1 });
    expect(event).toMatchObject({ jobId: input.jobId, eventType: "module.updated" });
  });

  it("returns events ordered by increasing bigint cursor", async () => {
    const userId = await createUser();
    const { input } = await createAnalysis(userId);
    const firstId = await repository.appendEvent({
      jobId: input.jobId,
      userId,
      eventType: "job.started",
      payload: { state: "running" },
      now,
    });
    const secondId = await repository.appendEvent({
      jobId: input.jobId,
      userId,
      eventType: "baseline.completed",
      payload: { state: "completed" },
      now,
    });

    await expect(repository.listEvents(userId, input.jobId, firstId, 10)).resolves.toEqual([
      expect.objectContaining({ id: secondId, eventType: "baseline.completed" }),
    ]);
  });

  it("prevents stale job status compare-and-set updates", async () => {
    const userId = await createUser();
    const { input } = await createAnalysis(userId);

    await expect(repository.transitionJob(input.jobId, ["queued"], "running")).resolves.toBe(true);
    await expect(repository.transitionJob(input.jobId, ["queued"], "recoverable")).resolves.toBe(false);
  });

  it("deduplicates sources by report and source key", async () => {
    const userId = await createUser();
    const { input } = await createAnalysis(userId);
    const source = {
      id: "source-1",
      title: "来源",
      url: "https://example.com/report",
      domain: "example.com",
      publisher: "Example",
      publishedAt: null,
      qualityTier: 1,
      excerpt: "摘要",
    };

    await repository.replaceSources(input.reportId, [source, source]);

    await expect(db.select().from(reportSources)).resolves.toHaveLength(1);
    await expect(db.select().from(reportModules)).resolves.toHaveLength(6);
  });

  it("rejects non-persisted source metadata from a sources replacement", async () => {
    const userId = await createUser();
    const { input } = await createAnalysis(userId);
    const oldSource = {
      id: "source-old",
      title: "旧来源",
      url: "https://example.com/old",
      domain: "example.com",
      publisher: "Example",
      publishedAt: null,
      qualityTier: 2,
      excerpt: "旧摘要",
    };
    const gap = {
      id: "gap-1",
      text: "缺少近期数据。",
      origin: "source_material" as const,
      sourceMaterialQuote: "唯一选择。",
      confidence: { score: 0.7, rationale: "材料没有给出数据" },
    };
    await repository.saveModule({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      moduleType: "sources",
      status: "completed",
      payload: { claims: [], sources: [oldSource], relations: [], gaps: [gap] },
      expectedVersion: 0,
      nextVersion: 1,
      now,
    });
    await repository.replaceSources(input.reportId, [oldSource]);
    const challenge = await repository.createChallenge({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      target: { moduleType: "sources", section: "gaps", itemId: gap.id },
      content: "请补充近期来源。",
      idempotencyKey: "challenge-new-source",
      now,
    });
    if (!challenge) throw new Error("Expected owned challenge");
    const leaseId = await acquireRevision(input, userId, challenge.messageId, "new-source-worker");
    const newSource = {
      id: "source-new",
      title: "新来源",
      url: "https://example.com/new",
      domain: "example.com",
      publisher: "Example",
      publishedAt: null,
      qualityTier: 1,
      excerpt: "新摘要",
    };

    const result = await repository.completeRevision({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      messageId: challenge.messageId,
      leaseId,
      agentContent: "已补充近期来源。",
      expectedReportVersion: 0,
      module: {
        moduleType: "sources",
        payload: { claims: [], sources: [newSource], relations: [], gaps: [] },
        expectedVersion: 1,
        nextVersion: 2,
      },
      changes: [{
        target: { moduleType: "sources", section: "gaps", itemId: gap.id },
        reason: "找到近期数据。",
        newEvidenceSourceIds: [newSource.id],
        summary: "补充来源并关闭缺口。",
      }],
      now,
    });

    const undeclaredReferenceResult = await repository.completeRevision({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      messageId: challenge.messageId,
      leaseId,
      agentContent: "不应保存未持久化来源引用。",
      expectedReportVersion: 0,
      module: {
        moduleType: "sources",
        payload: {
          claims: [],
          sources: [oldSource],
          relations: [],
          gaps: [{
            id: gap.id,
            text: "LLM 引用了未持久化来源。",
            origin: "external_source",
            sourceId: "source-hallucinated",
            confidence: { score: 0.8, rationale: "声称来自外部来源" },
          }],
        },
        expectedVersion: 1,
        nextVersion: 2,
      },
      changes: [{
        target: { moduleType: "sources", section: "gaps", itemId: gap.id },
        reason: "引用外部来源。",
        newEvidenceSourceIds: [],
        summary: "更新缺口。",
      }],
      now,
    });

    const sources = await db
      .select({ sourceKey: reportSources.sourceKey, title: reportSources.title })
      .from(reportSources);
    const snapshot = await repository.getOwnedSnapshot(userId, input.jobId);
    expect(result).toEqual({ completed: false });
    expect(undeclaredReferenceResult).toEqual({ completed: false });
    expect(sources).toEqual([{ sourceKey: oldSource.id, title: oldSource.title }]);
    expect(snapshot).toMatchObject({
      currentVersion: 0,
      revisions: [],
      modules: {
        sources: {
          version: 1,
          payload: { sources: [oldSource], gaps: [gap] },
        },
      },
    });
  });

  it("preserves source metadata referenced by revision history", async () => {
    const userId = await createUser();
    const { input } = await createAnalysis(userId);
    await seedPersistedRisk(input.reportId);
    const source = {
      id: "source-history",
      title: "历史证据",
      url: "https://example.com/history",
      domain: "example.com",
      publisher: "Example",
      publishedAt: null,
      qualityTier: 1,
      excerpt: "历史证据摘要",
    };
    await repository.replaceSources(input.reportId, [source]);
    const challenge = await repository.createChallenge({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      target: { moduleType: "risks", section: "items", itemId: "risk-1" },
      content: "请用来源复核。",
      idempotencyKey: "challenge-source-history",
      now,
    });
    if (!challenge) throw new Error("Expected owned challenge");
    const leaseId = await acquireRevision(input, userId, challenge.messageId, "source-history-worker");
    const completion = await repository.completeRevision({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      messageId: challenge.messageId,
      leaseId,
      agentContent: "来源支持修订。",
      expectedReportVersion: 0,
      module: {
        moduleType: "risks",
        payload: { items: [] },
        expectedVersion: 0,
        nextVersion: 1,
      },
      changes: [{
        target: { moduleType: "risks", section: "items", itemId: "risk-1" },
        reason: "来源支持。",
        newEvidenceSourceIds: [source.id],
        summary: "更新风险。",
      }],
      now,
    });
    expect(completion.completed).toBe(true);

    await repository.replaceSources(input.reportId, []);

    await expect(db.select({ sourceKey: reportSources.sourceKey }).from(reportSources)).resolves.toEqual([
      { sourceKey: source.id },
    ]);
  });

  it("serializes source replacement with revision evidence completion", async () => {
    const userId = await createUser();
    const { input } = await createAnalysis(userId);
    await seedPersistedRisk(input.reportId);
    const source = {
      id: "source-concurrent",
      title: "并发证据",
      url: "https://example.com/concurrent",
      domain: "example.com",
      publisher: "Example",
      publishedAt: null,
      qualityTier: 1,
      excerpt: "并发证据摘要",
    };
    await repository.replaceSources(input.reportId, [source]);
    const challenge = await repository.createChallenge({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      target: { moduleType: "risks", section: "items", itemId: "risk-1" },
      content: "请并发复核来源。",
      idempotencyKey: "challenge-source-concurrent",
      now,
    });
    if (!challenge) throw new Error("Expected owned challenge");
    const leaseId = await acquireRevision(input, userId, challenge.messageId, "source-concurrent-worker");
    let moduleLocked!: () => void;
    let releaseModule!: () => void;
    const locked = new Promise<void>((resolve) => { moduleLocked = resolve; });
    const release = new Promise<void>((resolve) => { releaseModule = resolve; });
    const moduleLock = db.transaction(async (tx) => {
      await tx
        .select({ id: reportModules.id })
        .from(reportModules)
        .where(and(
          eq(reportModules.reportId, input.reportId),
          eq(reportModules.moduleType, "risks"),
        ))
        .for("update");
      moduleLocked();
      await release;
    });
    await locked;
    const completion = repository.completeRevision({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      messageId: challenge.messageId,
      leaseId,
      agentContent: "并发来源支持修订。",
      expectedReportVersion: 0,
      module: {
        moduleType: "risks",
        payload: { items: [] },
        expectedVersion: 0,
        nextVersion: 1,
      },
      changes: [{
        target: { moduleType: "risks", section: "items", itemId: "risk-1" },
        reason: "并发来源支持。",
        newEvidenceSourceIds: [source.id],
        summary: "更新风险。",
      }],
      now,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    let replacementSettled = false;
    const replacement = repository.replaceSources(input.reportId, []).finally(() => {
      replacementSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const settledBeforeRelease = replacementSettled;
    releaseModule();
    await moduleLock;
    const result = await completion;
    await replacement;

    expect(settledBeforeRelease).toBe(false);
    expect(result.completed).toBe(true);
    await expect(db.select({ sourceKey: reportSources.sourceKey }).from(reportSources)).resolves.toEqual([
      { sourceKey: source.id },
    ]);
  });

  it("backfills stable unique IDs into legacy risk payloads so they remain targetable", async () => {
    const userId = await createUser();
    const { input } = await createAnalysis(userId);
    const legacyRisk = {
      type: "overgeneralization",
      sourceMaterialQuote: "唯一选择。",
      explanation: "把单一选项扩大成唯一选项。",
      confidence: { score: 0.8, rationale: "存在绝对化表达" },
    };
    await db
      .update(reportModules)
      .set({ status: "completed", version: 1, payload: { items: [legacyRisk, legacyRisk] } })
      .where(
        and(
          eq(reportModules.reportId, input.reportId),
          eq(reportModules.moduleType, "risks"),
        ),
      );
    const migrationSql = readMigrationFiles({
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    }).flatMap((migration) => migration.sql);
    const backfill = migrationSql.find(
      (statement) => statement.includes("jsonb_array_elements") && statement.includes("report_modules"),
    );

    expect(backfill).toBeDefined();
    if (!backfill) return;
    await db.execute(sql.raw(backfill));
    const firstSnapshot = await repository.getOwnedSnapshot(userId, input.jobId);
    const firstRisks = risksModuleSchema.parse(firstSnapshot?.modules.risks.payload);
    const firstIds = firstRisks.items.map((item) => item.id);

    await db.execute(sql.raw(backfill));
    const secondSnapshot = await repository.getOwnedSnapshot(userId, input.jobId);
    const secondRisks = risksModuleSchema.parse(secondSnapshot?.modules.risks.payload);

    expect(new Set(firstIds).size).toBe(2);
    expect(secondRisks.items.map((item) => item.id)).toEqual(firstIds);
    const migratedTarget = {
      moduleType: "risks",
      section: "items",
      itemId: firstIds[0],
    } as const;
    expect(resolveReportItemTarget(secondSnapshot!.modules, migratedTarget)).toBe(true);
    await expect(repository.createChallenge({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      target: migratedTarget,
      content: "升级后质疑旧风险。",
      idempotencyKey: "challenge-migrated-risk",
      now,
    })).resolves.toMatchObject({ created: true });
  });

  it("rewrites repeated non-empty legacy risk IDs deterministically", async () => {
    const userId = await createUser();
    const { input } = await createAnalysis(userId);
    const risk = (quote: string) => ({
      id: "legacy-duplicate",
      type: "overgeneralization" as const,
      sourceMaterialQuote: quote,
      explanation: "把单一选项扩大成唯一选项。",
      confidence: { score: 0.8, rationale: "存在绝对化表达" },
    });
    await db
      .update(reportModules)
      .set({ status: "completed", version: 1, payload: { items: [risk("第一项。"), risk("第二项。")] } })
      .where(and(
        eq(reportModules.reportId, input.reportId),
        eq(reportModules.moduleType, "risks"),
      ));
    const migrationSql = readMigrationFiles({
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    }).flatMap((migration) => migration.sql);
    const backfill = migrationSql.find(
      (statement) => statement.includes("jsonb_array_elements") && statement.includes("report_modules"),
    );
    expect(backfill).toBeDefined();
    if (!backfill) return;

    await db.execute(sql.raw(backfill));
    const firstSnapshot = await repository.getOwnedSnapshot(userId, input.jobId);
    const firstRisks = risksModuleSchema.parse(firstSnapshot?.modules.risks.payload);
    const firstIds = firstRisks.items.map((item) => item.id);
    await db.execute(sql.raw(backfill));
    const secondSnapshot = await repository.getOwnedSnapshot(userId, input.jobId);
    const secondRisks = risksModuleSchema.parse(secondSnapshot?.modules.risks.payload);

    expect(firstIds[0]).toBe("legacy-duplicate");
    expect(firstIds[1]).toMatch(/^migrated-risk-/);
    expect(secondRisks.items.map((item) => item.id)).toEqual(firstIds);
    expect(resolveReportItemTarget(secondSnapshot!.modules, {
      moduleType: "risks",
      section: "items",
      itemId: firstIds[1],
    })).toBe(true);
  });
});
