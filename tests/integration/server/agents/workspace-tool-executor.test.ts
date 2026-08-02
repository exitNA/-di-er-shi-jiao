import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  baselineDraftSchema,
  moduleTypes,
} from "@/features/analysis/domain/contracts";
import { PostgresAnalysisRepository } from "@/features/analysis/server/postgres-analysis-repository";
import { WorkspaceToolExecutor, type WorkspaceToolName } from "@/server/agents/workspace-tool-executor";
import { users } from "@/server/db/schema/auth";
import { reportModules } from "@/server/db/schema/analysis";
import { createTestDb, migrateTestDb, truncateTestDb } from "../../../helpers/database";
import { createStubExpertSuite } from "../../../helpers/stub-expert-suite";

const db = createTestDb();
const repository = new PostgresAnalysisRepository(db);
const now = new Date("2026-08-02T00:00:00.000Z");

async function createRunningWorkspace() {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  await db.insert(users).values({
    id: userId,
    username: `reader_${userId.slice(0, 8)}`,
    normalizedUsername: `reader_${userId.slice(0, 8)}`,
    createdAt: now,
  });
  await repository.createAnalysis({
    jobId: workspaceId,
    materialId: randomUUID(),
    reportId: randomUUID(),
    userId,
    content: "raw-secret：可追溯的素材。",
    detectedLanguage: "zh",
    idempotencyKey: randomUUID(),
    configVersion: "agent-v1",
    now,
  });
  const run = await repository.createAgentRun({
    workspaceId,
    userId,
    kind: "baseline",
    configVersion: "agent-v1",
    now,
  });
  if (!run) throw new Error("Failed to create Agent run");
  const claimed = await repository.claimAgentRun({ workspaceId, userId, agentRunId: run.id, now });
  if (!claimed) throw new Error("Failed to claim Agent run");
  return { workspaceId, userId, agentRunId: run.id };
}

describe("WorkspaceToolExecutor persistence", () => {
  beforeAll(() => migrateTestDb());
  beforeEach(() => truncateTestDb());
  afterAll(() => db.$client.end());

  it("persists validated review findings and publishes only after the guarded sequence", async () => {
    const workspace = await createRunningWorkspace();
    const executor = new WorkspaceToolExecutor(
      createStubExpertSuite(),
      repository,
      () => now,
    );
    const context = { workspaceId: workspace.workspaceId, agentRunId: workspace.agentRunId };
    const tools: WorkspaceToolName[] = [
      "analyze_argument",
      "research_sources",
      "map_perspectives",
      "review_risks",
      "synthesize_report",
      "review_draft",
      "revise_report",
      "publish_report",
    ];

    for (const toolName of tools) expect(await executor.execute(toolName, context)).toMatchObject({ ok: true });
    expect(await executor.execute("review_target", context)).toEqual({
      ok: false,
      code: "TOOL_NOT_ALLOWED",
    });

    const artifact = await repository.findCompletedAgentToolArtifact({
      workspaceId: workspace.workspaceId,
      userId: workspace.userId,
      toolName: "review_draft",
    });
    const snapshot = await repository.getOwnedSnapshot(workspace.userId, workspace.workspaceId);
    expect(artifact).toEqual({
      kind: "draft_review",
      review: { findings: [] },
      inputVersions: { overview: 1, argument: 1, perspectives: 1, sources: 1, risks: 1, reflection: 1 },
    });
    expect(Object.values(snapshot?.modules ?? {}).every((module) => module.status === "completed")).toBe(true);
    expect(snapshot?.toolCalls.every((call) => !JSON.stringify(call).includes("raw-secret"))).toBe(true);
    expect(snapshot?.toolCalls.every((call) => !("artifact" in call))).toBe(true);

    const target = { moduleType: "risks" as const, section: "items", itemId: "risk-overgeneralization" };
    await repository.finishAgentRun({
      workspaceId: workspace.workspaceId,
      userId: workspace.userId,
      agentRunId: workspace.agentRunId,
      status: "completed",
      now,
    });
    const challengeNow = new Date(now.getTime() + 1);
    const challenge = await repository.createChallenge({
      jobId: workspace.workspaceId,
      reportId: snapshot?.reportId ?? "",
      userId: workspace.userId,
      target,
      content: "这项风险是否超出材料？",
      idempotencyKey: randomUUID(),
      now: challengeNow,
    });
    if (!challenge) throw new Error("Failed to create challenge");
    const challengeRun = await repository.createAgentRun({
      workspaceId: workspace.workspaceId,
      userId: workspace.userId,
      kind: "challenge",
      messageId: challenge.messageId,
      configVersion: "agent-v1",
      now: challengeNow,
    });
    if (!challengeRun) throw new Error("Failed to create challenge Agent run");
    await repository.claimAgentRun({
      workspaceId: workspace.workspaceId,
      userId: workspace.userId,
      agentRunId: challengeRun.id,
      now: challengeNow,
    });
    const challengeContext = {
      workspaceId: workspace.workspaceId,
      agentRunId: challengeRun.id,
      messageId: challenge.messageId,
      target,
    };
    expect(await executor.execute("analyze_argument", challengeContext)).toEqual({
      ok: false,
      code: "TOOL_NOT_ALLOWED",
    });
    expect(await executor.execute("review_target", challengeContext)).toMatchObject({ ok: true });
    const revised = await repository.getOwnedSnapshot(workspace.userId, workspace.workspaceId);
    expect(revised?.currentVersion).toBe(1);
    expect(revised?.modules.risks.payload).toMatchObject({ items: [] });
  });

  it("rolls back every revision module when a later module version conflicts", async () => {
    const workspace = await createRunningWorkspace();
    const executor = new WorkspaceToolExecutor(
      createStubExpertSuite(),
      repository,
      () => now,
    );
    const context = { workspaceId: workspace.workspaceId, agentRunId: workspace.agentRunId };
    for (const toolName of [
      "analyze_argument",
      "research_sources",
      "map_perspectives",
      "review_risks",
      "synthesize_report",
      "review_draft",
    ] as const) {
      await executor.execute(toolName, context);
    }
    const before = await repository.getOwnedSnapshot(workspace.userId, workspace.workspaceId);
    if (!before) throw new Error("Missing baseline draft");
    const draft = baselineDraftSchema.parse(Object.fromEntries(
      moduleTypes.map((moduleType) => [moduleType, before.modules[moduleType].payload]),
    ));
    const revised = {
      ...draft,
      argument: { ...draft.argument, claims: [] },
    };

    await expect(repository.saveRevisionDraft({
      jobId: workspace.workspaceId,
      reportId: before.reportId,
      userId: workspace.userId,
      draft: revised,
      expectedVersions: {
        overview: 1,
        argument: 1,
        perspectives: 1,
        sources: 0,
        risks: 1,
        reflection: 1,
      },
      nextVersions: {
        overview: 1,
        argument: 2,
        perspectives: 1,
        sources: 1,
        risks: 1,
        reflection: 1,
      },
      now,
    })).resolves.toBe(false);

    const after = await repository.getOwnedSnapshot(workspace.userId, workspace.workspaceId);
    expect(after?.modules.argument).toEqual(before.modules.argument);
    expect(after?.modules.sources).toEqual(before.modules.sources);
  });

  it("atomically rejects the seventeenth concurrent tool call", async () => {
    const workspace = await createRunningWorkspace();
    const results = await Promise.all(Array.from({ length: 17 }, (_, index) =>
      repository.appendAgentToolCall({
        ...workspace,
        toolName: "analyze_argument",
        summary: `调用 ${index + 1}`,
        now,
      })
    ));

    expect(results.filter((result) => result && "id" in result)).toHaveLength(16);
    expect(results.filter((result) => result && "code" in result)).toEqual([
      { code: "TOOL_CALL_BUDGET_EXCEEDED" },
    ]);
    expect((await repository.getOwnedSnapshot(workspace.userId, workspace.workspaceId))?.toolCalls).toHaveLength(16);
  });

  it("refuses a no-change response when the reviewed target module changed concurrently", async () => {
    const workspace = await createRunningWorkspace();
    const snapshot = await repository.getOwnedSnapshot(workspace.userId, workspace.workspaceId);
    if (!snapshot) throw new Error("Missing workspace snapshot");
    const target = { moduleType: "risks" as const, section: "items", itemId: "risk-1" };
    const original = {
      items: [{
        id: "risk-1",
        type: "overgeneralization" as const,
        sourceMaterialQuote: "可追溯的素材。",
        explanation: "结论范围过宽。",
        confidence: { score: 0.8, rationale: "材料只有单一陈述" },
      }],
    };
    await repository.saveModule({
      jobId: workspace.workspaceId,
      reportId: snapshot.reportId,
      userId: workspace.userId,
      moduleType: "risks",
      status: "completed",
      payload: original,
      expectedVersion: 0,
      nextVersion: 1,
      now,
    });
    const challenge = await repository.createChallenge({
      jobId: workspace.workspaceId,
      reportId: snapshot.reportId,
      userId: workspace.userId,
      target,
      content: "这项风险还成立吗？",
      idempotencyKey: randomUUID(),
      now,
    });
    if (!challenge) throw new Error("Failed to create challenge");
    const leaseId = randomUUID();
    await repository.startRevision({
      jobId: workspace.workspaceId,
      reportId: snapshot.reportId,
      userId: workspace.userId,
      messageId: challenge.messageId,
      leaseId,
      leaseExpiresAt: new Date(now.getTime() + 30_000),
      now,
    });
    let targetUpdated!: () => void;
    let allowCommit!: () => void;
    const updated = new Promise<void>((resolve) => { targetUpdated = resolve; });
    const commit = new Promise<void>((resolve) => { allowCommit = resolve; });
    const concurrentChange = db.transaction(async (tx) => {
      await tx
        .update(reportModules)
        .set({ payload: { items: [] }, version: 2, updatedAt: now })
        .where(and(
          eq(reportModules.reportId, snapshot.reportId),
          eq(reportModules.moduleType, "risks"),
          eq(reportModules.version, 1),
        ));
      targetUpdated();
      await commit;
    });
    await updated;

    const completion = repository.completeRevisionResponse({
      jobId: workspace.workspaceId,
      reportId: snapshot.reportId,
      userId: workspace.userId,
      messageId: challenge.messageId,
      leaseId,
      agentContent: "无需修改。",
      expectedReportVersion: 0,
      target,
      expectedModuleVersion: 1,
      now,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    allowCommit();
    await concurrentChange;
    await expect(completion).resolves.toBe(false);
    const latest = await repository.getOwnedSnapshot(workspace.userId, workspace.workspaceId);
    expect(latest?.messages.find((message) => message.id === challenge.messageId)?.status).toBe("running");
  });
});
