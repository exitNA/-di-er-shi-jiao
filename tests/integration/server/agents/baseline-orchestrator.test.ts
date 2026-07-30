import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgresAnalysisRepository } from "@/features/analysis/server/postgres-analysis-repository";
import { BaselineOrchestrator } from "@/server/agents/baseline-orchestrator";
import { FakeExpertSuite } from "@/server/agents/fake-expert-suite";
import { users } from "@/server/db/schema/auth";
import { createTestDb, migrateTestDb, truncateTestDb } from "../../../helpers/database";

const db = createTestDb();
const repository = new PostgresAnalysisRepository(db);

async function createJob() {
  const now = new Date("2026-07-30T00:00:00.000Z");
  const userId = randomUUID();
  await db.insert(users).values({ id: userId, username: `reader_${userId.slice(0, 8)}`, normalizedUsername: `reader_${userId.slice(0, 8)}`, createdAt: now });
  const input = { jobId: randomUUID(), materialId: randomUUID(), reportId: randomUUID(), userId, content: "可追溯的素材。", detectedLanguage: "zh" as const, idempotencyKey: randomUUID(), configVersion: "v1", now };
  await repository.createAnalysis(input);
  return input;
}

describe("BaselineOrchestrator persistence", () => {
  beforeAll(() => migrateTestDb());
  beforeEach(() => truncateTestDb());
  afterAll(() => db.$client.end());

  it("persists a completed six-module baseline", async () => {
    const input = await createJob();
    const result = await new BaselineOrchestrator(new FakeExpertSuite({ delaysMs: { argument: 0, perspectives: 0, sources: 0, risks: 0 } }), repository).run({ jobId: input.jobId });
    const snapshot = await repository.getOwnedSnapshot(input.userId, input.jobId);

    expect(result.status).toBe("completed");
    expect(Object.values(snapshot?.modules ?? {}).every((module) => module.status === "completed")).toBe(true);
  });
});
