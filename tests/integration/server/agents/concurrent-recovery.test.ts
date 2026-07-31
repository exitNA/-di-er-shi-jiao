import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PostgresAnalysisRepository } from "@/features/analysis/server/postgres-analysis-repository";
import { submitAnalysis } from "@/features/analysis/server/submit-analysis";
import { analysisJobs } from "@/server/db/schema/analysis";
import { users } from "@/server/db/schema/auth";
import {
  createTestDb,
  migrateTestDb,
  truncateTestDb,
} from "../../../helpers/database";

const db = createTestDb();
const repository = new PostgresAnalysisRepository(db);

describe("concurrent analysis submission", () => {
  beforeAll(() => migrateTestDb());
  beforeEach(() => truncateTestDb());
  afterAll(() => db.$client.end());

  it("creates one job and dispatches once for one concurrent idempotency key", async () => {
    const now = new Date("2026-07-30T00:00:00.000Z");
    const userId = randomUUID();
    await db.insert(users).values({
      id: userId,
      username: "concurrent_reader",
      normalizedUsername: "concurrent_reader",
      createdAt: now,
    });
    const enqueue = vi.fn().mockResolvedValue({ runId: "run-1" });
    const input = {
      userId,
      content: "并发提交必须只创建一个后台任务。",
      idempotencyKey: "same-browser-submission",
    };

    const results = await Promise.all([
      submitAnalysis(input, repository, { enqueue }, () => now),
      submitAnalysis(input, repository, { enqueue }, () => now),
    ]);
    const jobs = await db
      .select({ id: analysisJobs.id })
      .from(analysisJobs)
      .where(eq(analysisJobs.userId, userId));

    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.map((result) => result.ok && result.jobId)).toEqual([
      jobs[0].id,
      jobs[0].id,
    ]);
    expect(results.filter((result) => result.ok && result.created)).toHaveLength(1);
    expect(jobs).toHaveLength(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith({
      jobId: jobs[0].id,
      dispatchKey: `${jobs[0].id}:baseline`,
    });
  });
});
