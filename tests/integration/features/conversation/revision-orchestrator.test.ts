import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { PostgresAnalysisRepository } from "@/features/analysis/server/postgres-analysis-repository";
import { RevisionOrchestrator } from "@/features/conversation/server/revision-orchestrator";
import { submitChallenge } from "@/features/conversation/server/submit-challenge";
import { FakeExpertSuite } from "@/server/agents/fake-expert-suite";
import { analysisEvents, productEvents } from "@/server/db/schema/analysis";
import { users } from "@/server/db/schema/auth";
import { recordProductEvent } from "@/server/observability/product-events";
import { createTestDb, migrateTestDb, truncateTestDb } from "../../../helpers/database";

const db = createTestDb();
const repository = new PostgresAnalysisRepository(db);
const now = new Date("2026-08-01T00:00:00.000Z");
const target = { moduleType: "risks", section: "items", itemId: "risk-1" } as const;

describe("conversation revision flow", () => {
  beforeAll(() => migrateTestDb());
  beforeEach(() => truncateTestDb());
  afterAll(() => db.$client.end());

  it("revises the challenged risk once and keys both product events by their durable IDs", async () => {
    const fixture = await createCompletedRiskReport();
    const experts = new FakeExpertSuite({ delaysMs: { revision: 0 } });
    const review = vi.spyOn(experts, "reviewTarget");
    const orchestrator = new RevisionOrchestrator(experts, repository, () => now, recorder);
    const input = {
      userId: fixture.userId,
      jobId: fixture.jobId,
      target,
      content: "这项风险误读了原文，请重新核对。",
      idempotencyKey: "challenge-1",
    };

    const first = await submitChallenge(input, repository, orchestrator, () => now, recorder);
    const replay = await submitChallenge(input, repository, orchestrator, () => now, recorder);

    expect(first).toMatchObject({ ok: true, created: true, status: "completed" });
    expect(replay).toMatchObject({ ok: true, created: false, status: "completed" });
    expect(review).toHaveBeenCalledOnce();
    const snapshot = await repository.getOwnedSnapshot(fixture.userId, fixture.jobId);
    expect(snapshot).toMatchObject({ currentVersion: 1 });
    expect(snapshot?.modules.risks).toMatchObject({ status: "completed", version: 2, payload: { items: [] } });
    expect(snapshot?.messages).toHaveLength(2);
    expect(snapshot?.revisions).toHaveLength(1);
    expect(await db.select().from(analysisEvents)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: "conversation.updated",
        payload: { messageId: first.ok ? first.messageId : "unreachable", status: "queued" },
      }),
    ]));
    const events = await db.select().from(productEvents);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventName: "report_item_challenged",
        eventKey: first.ok ? first.messageId : "unreachable",
      }),
      expect.objectContaining({
        eventName: "report_revised",
        eventKey: first.ok ? first.revisionId : "unreachable",
      }),
    ]));
    expect(events).toHaveLength(2);
  });

  it("marks an Agent failure recoverable without changing the baseline report", async () => {
    const fixture = await createCompletedRiskReport();
    const before = await repository.getOwnedSnapshot(fixture.userId, fixture.jobId);
    const experts = new FakeExpertSuite({
      delaysMs: { revision: 0 },
      failures: { revision: "EXPERT_FAILED" },
    });
    const orchestrator = new RevisionOrchestrator(experts, repository, () => now, recorder);

    const result = await submitChallenge({
      userId: fixture.userId,
      jobId: fixture.jobId,
      target,
      content: "这项风险误读了原文。",
      idempotencyKey: "challenge-failure",
    }, repository, orchestrator, () => now, recorder);

    expect(result).toMatchObject({ ok: true, status: "recoverable" });
    const after = await repository.getOwnedSnapshot(fixture.userId, fixture.jobId);
    expect(after).toMatchObject({
      status: before?.status,
      currentVersion: before?.currentVersion,
      revisions: [],
      modules: { risks: before?.modules.risks },
    });
    expect(after?.messages).toEqual([
      expect.objectContaining({ role: "user", status: "recoverable" }),
    ]);
  });
});

const recorder = (input: Parameters<typeof recordProductEvent>[1]) => recordProductEvent(db, input);

async function createCompletedRiskReport() {
  const [user] = await db
    .insert(users)
    .values({
      username: `reader_${randomUUID().slice(0, 8)}`,
      normalizedUsername: `reader_${randomUUID().slice(0, 8)}`,
      createdAt: now,
    })
    .returning({ id: users.id });
  const jobId = randomUUID();
  const reportId = randomUUID();
  await repository.createAnalysis({
    jobId,
    reportId,
    materialId: randomUUID(),
    userId: user.id,
    content: "30 岁以后考公是获得稳定人生的唯一选择。",
    detectedLanguage: "mixed",
    idempotencyKey: randomUUID(),
    configVersion: "baseline-v1",
    now,
  });
  await repository.saveModule({
    jobId,
    reportId,
    userId: user.id,
    moduleType: "risks",
    status: "completed",
    payload: {
      items: [{
        id: "risk-1",
        type: "overgeneralization",
        sourceMaterialQuote: "30 岁以后考公是获得稳定人生的唯一选择。",
        explanation: "将单一选择扩大为唯一选择。",
        confidence: { score: 0.8, rationale: "存在绝对化表述" },
      }],
    },
    expectedVersion: 0,
    nextVersion: 1,
    now,
  });
  return { userId: user.id, jobId };
}
