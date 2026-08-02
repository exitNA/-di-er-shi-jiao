import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { render, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AnalysisWorkspace } from "@/features/analysis/components/analysis-workspace";
import type { AnalysisSnapshot } from "@/features/analysis/domain/contracts";
import { PostgresAnalysisRepository } from "@/features/analysis/server/postgres-analysis-repository";
import { submitAnalysis } from "@/features/analysis/server/submit-analysis";
import {
  analysisEvents,
  productEvents,
} from "@/server/db/schema/analysis";
import { users } from "@/server/db/schema/auth";
import {
  getJobOperationalMetrics,
  ProductEventJobNotOwnedError,
  recordProductEvent,
  type ProductEventInput,
} from "@/server/observability/product-events";
import {
  createTestDb,
  migrateTestDb,
  truncateTestDb,
} from "../../../helpers/database";

vi.mock("@/features/analysis/hooks/use-analysis-stream", () => ({
  useAnalysisStream: (_jobId: string, initialSnapshot: AnalysisSnapshot) => ({
    snapshot: initialSnapshot,
    connectionState: "connected",
    retryModule: vi.fn(),
  }),
}));

const db = createTestDb();
const repository = new PostgresAnalysisRepository(db);
const now = new Date("2026-07-30T00:00:00.000Z");

describe("product events", () => {
  beforeAll(() => migrateTestDb());
  beforeEach(() => truncateTestDb());
  afterAll(() => db.$client.end());

  it("rejects unknown names and jobs not owned by the current user", async () => {
    const ownerId = await createUser();
    const otherUserId = await createUser();
    const jobId = await createAnalysis(ownerId);

    await expect(
      recordProductEvent(db, {
        userId: ownerId,
        jobId,
        eventName: "unknown_event",
      } as never),
    ).rejects.toThrow(/Unknown product event/);
    await expect(
      recordProductEvent(db, {
        userId: otherUserId,
        jobId,
        eventName: "analysis_submitted",
      }),
    ).rejects.toBeInstanceOf(ProductEventJobNotOwnedError);
  });

  it("records first_module_shown once per job as a browser milestone", async () => {
    const userId = await createUser();
    const jobId = await createAnalysis(userId);
    const event = {
      userId,
      jobId,
      eventName: "first_module_shown" as const,
      moduleType: "argument" as const,
      now,
    };

    await expect(recordProductEvent(db, event)).resolves.toBe(true);
    await expect(recordProductEvent(db, event)).resolves.toBe(false);

    await expect(db.select().from(productEvents)).resolves.toEqual([
      expect.objectContaining({
        eventName: "first_module_shown",
        eventKey: jobId,
        properties: {
          moduleType: "argument",
          browserVisible: true,
        },
      }),
    ]);
  });

  it("records analysis_submitted after creation and not for an idempotent replay", async () => {
    const userId = await createUser();
    const recorder = vi.fn((input: ProductEventInput) =>
      recordProductEvent(db, input),
    );
    const input = {
      userId,
      content: "待分析材料",
      idempotencyKey: "same-submission",
    };

    await expect(
      submitAnalysis(input, repository, { enqueue: vi.fn() }, () => now, recorder),
    ).resolves.toMatchObject({ ok: true, created: true });
    await expect(
      submitAnalysis(input, repository, { enqueue: vi.fn() }, () => now, recorder),
    ).resolves.toMatchObject({ ok: true, created: false });

    expect(recorder).toHaveBeenCalledOnce();
    await expect(db.select().from(productEvents)).resolves.toEqual([
      expect.objectContaining({
        eventName: "analysis_submitted",
        eventKey: expect.any(String),
        userId,
      }),
    ]);
  });

  it("sends first_module_shown after a completed module renders", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 201 }));
    const modules = emptyModules();
    modules.argument = { status: "completed", version: 2 };

    render(
      createElement(AnalysisWorkspace, {
        initialSnapshot: snapshot({ modules }),
      }),
    );

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "/api/product-events",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            eventName: "first_module_shown",
            jobId: "11111111-1111-4111-8111-111111111111",
            moduleType: "argument",
          }),
        }),
      ),
    );
  });

  it("derives per-job latency, success, and degradation metrics", async () => {
    const userId = await createUser();
    const jobId = await createAnalysis(userId);
    await repository.appendEvent({
      jobId,
      userId,
      eventType: "module.updated",
      payload: { moduleType: "argument", status: "completed", version: 2 },
      now: new Date(now.getTime() + 2_500),
    });
    await repository.appendEvent({
      jobId,
      userId,
      eventType: "report.degraded",
      payload: { moduleType: "sources", errorCode: "SEARCH_UNAVAILABLE" },
      now: new Date(now.getTime() + 8_000),
    });
    const completedRunId = randomUUID();
    await repository.startExpertRun({
      id: completedRunId,
      jobId,
      expertType: "argument",
      phase: "baseline",
      attempt: 1,
      configVersion: "baseline-v1",
      now,
    });
    await repository.finishExpertRun({
      id: completedRunId,
      status: "completed",
      inputTokens: 10,
      outputTokens: 5,
      estimatedCostUsd: "0.000001",
      latencyMs: 1,
      now,
    });
    const failedRunId = randomUUID();
    await repository.startExpertRun({
      id: failedRunId,
      jobId,
      expertType: "sources",
      phase: "baseline",
      attempt: 1,
      configVersion: "baseline-v1",
      now,
    });
    await repository.finishExpertRun({
      id: failedRunId,
      status: "failed",
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: "0",
      latencyMs: 1,
      errorCode: "SEARCH_UNAVAILABLE",
      now,
    });

    await expect(
      getJobOperationalMetrics(db, userId, jobId),
    ).resolves.toEqual({
      firstModuleLatencyMs: 2_500,
      completeLatencyMs: 8_000,
      expertSuccessRate: 0.5,
      degradedReportRate: 1,
    });
    await expect(
      db.select().from(analysisEvents),
    ).resolves.toHaveLength(2);
  });
});

async function createUser(): Promise<string> {
  const username = `reader_${randomUUID().slice(0, 8)}`;
  const [user] = await db
    .insert(users)
    .values({ username, normalizedUsername: username, createdAt: now })
    .returning({ id: users.id });
  return user.id;
}

async function createAnalysis(userId: string): Promise<string> {
  const jobId = randomUUID();
  await repository.createAnalysis({
    jobId,
    materialId: randomUUID(),
    reportId: randomUUID(),
    userId,
    content: "待分析材料",
    detectedLanguage: "zh",
    idempotencyKey: randomUUID(),
    configVersion: "baseline-v1",
    now,
  });
  return jobId;
}

function snapshot(
  overrides: Partial<AnalysisSnapshot> = {},
): AnalysisSnapshot {
  return {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    reportId: "22222222-2222-4222-8222-222222222222",
    currentVersion: 0,
    status: "running",
    configVersion: "baseline-v1",
    materialPreview: "待分析材料",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    lastEventId: 0,
    activeRun: null,
    toolCalls: [],
    messages: [],
    revisions: [],
    modules: emptyModules(),
    ...overrides,
  };
}

function emptyModules(): AnalysisSnapshot["modules"] {
  return {
    overview: { status: "queued", version: 0 },
    argument: { status: "queued", version: 0 },
    perspectives: { status: "queued", version: 0 },
    sources: { status: "queued", version: 0 },
    risks: { status: "queued", version: 0 },
    reflection: { status: "queued", version: 0 },
  };
}
