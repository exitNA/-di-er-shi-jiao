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
import { analysisEvents, reportModules, reportSources, reports } from "@/server/db/schema/analysis";
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
    expect(ownerSnapshot?.messages).toHaveLength(1);
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
    const challenge = await repository.createChallenge({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      target: { moduleType: "risks", section: "items", itemId: "risk-1" },
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
    const challenge = await repository.createChallenge({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      target: { moduleType: "risks", section: "items", itemId: "risk-1" },
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
    })).resolves.toBe(false);
    await expect(repository.getOwnedSnapshot(userId, input.jobId)).resolves.toMatchObject({
      currentVersion: 1,
      messages: [expect.objectContaining({ role: "user", status: "recoverable" })],
    });
  });

  it("serializes response-only CAS against an uncommitted report revision", async () => {
    const userId = await createUser();
    const { input } = await createAnalysis(userId);
    const challenge = await repository.createChallenge({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      target: { moduleType: "risks", section: "items", itemId: "risk-1" },
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
});
