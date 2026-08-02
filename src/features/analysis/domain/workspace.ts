import { z } from "zod";

export const workspaceRunStatuses = [
  "queued",
  "running",
  "interrupted",
  "recoverable",
  "completed",
] as const;

export type WorkspaceRunStatus = (typeof workspaceRunStatuses)[number];

export const agentRunKinds = ["baseline", "challenge"] as const;

export type AgentRunKind = (typeof agentRunKinds)[number];

/**
 * A short status update that is safe to show in the workspace. It must never
 * contain a raw prompt, chain-of-thought, or raw model output.
 */
export const safeAgentSummarySchema = z.string().min(1).max(500);

export type SafeAgentSummary = z.infer<typeof safeAgentSummarySchema>;

export const workspaceDraftReviewSchema = z.object({
  findings: z.array(
    z.object({
      moduleType: z.enum(["overview", "argument", "perspectives", "sources", "risks", "reflection"]),
      statementId: z.string().min(1).max(200).optional(),
      problem: z.string().min(1).max(1_000),
      requiredChange: z.string().min(1).max(1_000),
    }).strict(),
  ).max(50),
}).strict();

export const workspaceModuleVersionsSchema = z.object({
  overview: z.number().int().nonnegative(),
  argument: z.number().int().nonnegative(),
  perspectives: z.number().int().nonnegative(),
  sources: z.number().int().nonnegative(),
  risks: z.number().int().nonnegative(),
  reflection: z.number().int().nonnegative(),
}).strict();

export const workspaceToolArtifactSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("baseline_module"),
    moduleType: z.enum(["argument", "sources", "perspectives", "risks"]),
    outputVersion: z.number().int().positive(),
  }).strict(),
  z.object({
    kind: z.literal("synthesis"),
    inputVersions: workspaceModuleVersionsSchema,
    outputVersions: workspaceModuleVersionsSchema,
  }).strict(),
  z.object({
    kind: z.literal("draft_review"),
    review: workspaceDraftReviewSchema,
    inputVersions: workspaceModuleVersionsSchema,
  }).strict(),
  z.object({
    kind: z.literal("revision"),
    inputVersions: workspaceModuleVersionsSchema,
    outputVersions: workspaceModuleVersionsSchema,
  }).strict(),
]);

export type WorkspaceToolArtifact = z.infer<typeof workspaceToolArtifactSchema>;

export const workspaceAgentRunSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    kind: z.enum(agentRunKinds),
    status: z.enum(workspaceRunStatuses),
    configVersion: z.string().min(1),
    messageId: z.string().uuid().nullable().optional(),
    cancellationRequestedAt: z.string().datetime().nullable(),
    startedAt: z.string().datetime().nullable(),
    completedAt: z.string().datetime().nullable(),
  })
  .strict();

export const workspaceToolCallSchema = z
  .object({
    id: z.string().uuid(),
    agentRunId: z.string().uuid(),
    toolName: z.string().min(1),
    status: z.enum(["running", "completed", "recoverable"]),
    summary: safeAgentSummarySchema,
    errorCode: z.string().min(1).nullable(),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
  })
  .strict();

export type WorkspaceAgentRun = z.infer<typeof workspaceAgentRunSchema>;
export type WorkspaceToolCall = z.infer<typeof workspaceToolCallSchema>;
