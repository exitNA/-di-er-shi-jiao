import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgresAnalysisRepository } from "@/features/analysis/server/postgres-analysis-repository";
import type { CompleteRevision } from "@/features/analysis/server/analysis-repository";
import { analysisEvents, reportModules, reportSources } from "@/server/db/schema/analysis";
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

    const first = await repository.completeRevision({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      messageId: challenge.messageId,
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
      now,
    });
    const stale = await repository.completeRevision({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      messageId: challenge.messageId,
      agentContent: "这次过期修订不应覆盖报告。",
      expectedReportVersion: 0,
      module: {
        moduleType: "risks",
        payload: { items: [] },
        expectedVersion: 1,
        nextVersion: 2,
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
    expect(snapshot?.messages).toHaveLength(2);
    expect(snapshot?.messages.find((message) => message.role === "user")).toMatchObject({
      status: "completed",
    });
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

    const result = await repository.completeRevision({
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      messageId: challenge.messageId,
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
    expect(snapshot?.messages).toEqual([expect.objectContaining({ status: "queued" })]);
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
    const invalidInput: unknown = {
      jobId: input.jobId,
      reportId: input.reportId,
      userId,
      messageId: challenge.messageId,
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
});
