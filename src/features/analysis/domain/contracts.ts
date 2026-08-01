import { z } from "zod";
import type { AnalysisJobStatus, ReportModuleStatus } from "./job-state";

export const originSchema = z.enum([
  "source_material",
  "external_source",
  "ai_inference",
]);

export const confidenceSchema = z.object({
  score: z.number().min(0).max(1),
  rationale: z.string().min(1).max(500),
});

export const traceableStatementSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    origin: originSchema,
    sourceMaterialQuote: z.string().min(1).optional(),
    sourceId: z.string().min(1).optional(),
    confidence: confidenceSchema,
  })
  .superRefine((value, context) => {
    if (value.origin === "source_material" && !value.sourceMaterialQuote) {
      context.addIssue({
        code: "custom",
        path: ["sourceMaterialQuote"],
        message: "sourceMaterialQuote is required",
      });
    }
    if (value.origin === "external_source" && !value.sourceId) {
      context.addIssue({
        code: "custom",
        path: ["sourceId"],
        message: "sourceId is required",
      });
    }
  });

export const externalSourceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  domain: z.string().min(1),
  publisher: z.string().min(1),
  publishedAt: z.string().min(1).nullable(),
  qualityTier: z.number().int().min(1).max(4),
  excerpt: z.string().min(1),
});

const statementList = z.array(traceableStatementSchema);

export const overviewModuleSchema = z.object({
  coreClaims: statementList,
  mainDisputes: statementList,
  topRisks: statementList,
  keyUnknowns: statementList,
  safetyNotice: z.string().min(1).nullable(),
});

export const argumentModuleSchema = z.object({
  factualOnly: z.boolean(),
  claims: statementList,
  evidence: statementList,
  assumptions: statementList,
  reasoningSteps: statementList,
  conclusions: statementList,
  gaps: statementList,
  factualStatements: statementList,
});

export const perspectivesModuleSchema = z.object({
  supporting: statementList,
  opposing: statementList,
  stakeholders: statementList,
  disputes: statementList,
  unknowns: statementList,
  changeEvidence: statementList,
});

export const sourceRelationSchema = z.object({
  claimId: z.string().min(1),
  sourceId: z.string().min(1),
  relation: z.enum(["supports", "challenges", "insufficient"]),
});

export const sourcesModuleSchema = z.object({
  claims: statementList,
  sources: z.array(externalSourceSchema),
  relations: z.array(sourceRelationSchema),
  gaps: statementList,
});

export const riskItemSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    "overgeneralization",
    "reversed_causality",
    "emotional_inducement",
    "concept_switching",
    "data_misleading",
  ]),
  sourceMaterialQuote: z.string().min(1),
  explanation: z.string().min(1),
  confidence: confidenceSchema,
});

export const risksModuleSchema = z.object({
  items: z.array(riskItemSchema),
}).superRefine(({ items }, context) => {
  const ids = new Set<string>();
  items.forEach((item, index) => {
    if (ids.has(item.id)) {
      context.addIssue({
        code: "custom",
        path: ["items", index, "id"],
        message: "risk item id must be unique",
      });
    }
    ids.add(item.id);
  });
});

export const reflectionModuleSchema = z.object({
  question: z.string().min(1),
  whyItMatters: z.string().min(1),
});

export const moduleTypes = [
  "overview",
  "argument",
  "perspectives",
  "sources",
  "risks",
  "reflection",
] as const;

export type ReportModuleType = (typeof moduleTypes)[number];

export const reportItemTargetSchema = z
  .object({
    moduleType: z.enum(moduleTypes),
    section: z.string().min(1),
    itemId: z.string().min(1),
  })
  .strict();

export const conversationMessageRoleSchema = z.enum(["user", "agent"]);
export const conversationMessageStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "recoverable",
]);

export const conversationMessageSchema = z
  .object({
    id: z.string().uuid(),
    reportId: z.string().uuid(),
    role: conversationMessageRoleSchema,
    target: reportItemTargetSchema,
    content: z.string().min(1),
    status: conversationMessageStatusSchema,
    idempotencyKey: z.string().min(1).nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();

export const reportRevisionChangeSchema = z
  .object({
    target: reportItemTargetSchema,
    reason: z.string().min(1),
    newEvidenceSourceIds: z.array(z.string().min(1)),
    summary: z.string().min(1),
  })
  .strict();

export const reportRevisionSchema = z
  .object({
    id: z.string().uuid(),
    triggeringMessageId: z.string().uuid(),
    fromVersion: z.number().int().min(0),
    toVersion: z.number().int().min(1),
    changes: z.array(reportRevisionChangeSchema).min(1),
    status: z.literal("completed"),
    createdAt: z.string().datetime(),
  })
  .strict();

export const baselineDraftSchema = z.object({
  overview: overviewModuleSchema,
  argument: argumentModuleSchema,
  perspectives: perspectivesModuleSchema,
  sources: sourcesModuleSchema,
  risks: risksModuleSchema,
  reflection: reflectionModuleSchema,
}).strict();

export type TraceableStatement = z.infer<typeof traceableStatementSchema>;
export type ExternalSource = z.infer<typeof externalSourceSchema>;
export type OverviewModule = z.infer<typeof overviewModuleSchema>;
export type ArgumentModule = z.infer<typeof argumentModuleSchema>;
export type PerspectivesModule = z.infer<typeof perspectivesModuleSchema>;
export type SourcesModule = z.infer<typeof sourcesModuleSchema>;
export type RisksModule = z.infer<typeof risksModuleSchema>;
export type ReflectionModule = z.infer<typeof reflectionModuleSchema>;
export type BaselineDraft = z.infer<typeof baselineDraftSchema>;
export type ReportItemTarget = z.infer<typeof reportItemTargetSchema>;
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export type ReportRevisionChange = z.infer<typeof reportRevisionChangeSchema>;
export type ReportRevision = z.infer<typeof reportRevisionSchema>;

export type AnalysisSnapshot = {
  jobId: string;
  reportId: string;
  currentVersion: number;
  status: AnalysisJobStatus;
  configVersion: string;
  materialPreview: string;
  createdAt: string;
  updatedAt: string;
  lastEventId: number;
  messages: ConversationMessage[];
  revisions: ReportRevision[];
  modules: Record<
    ReportModuleType,
    {
      status: ReportModuleStatus;
      version: number;
      errorCode?: string;
      payload?:
        | OverviewModule
        | ArgumentModule
        | PerspectivesModule
        | SourcesModule
        | RisksModule
        | ReflectionModule;
    }
  >;
};

const targetSections: Record<ReportModuleType, readonly string[]> = {
  overview: ["coreClaims", "mainDisputes", "topRisks", "keyUnknowns"],
  argument: [
    "claims",
    "evidence",
    "assumptions",
    "reasoningSteps",
    "conclusions",
    "gaps",
    "factualStatements",
  ],
  perspectives: [
    "supporting",
    "opposing",
    "stakeholders",
    "disputes",
    "unknowns",
    "changeEvidence",
  ],
  sources: ["relations", "gaps"],
  risks: ["items"],
  reflection: [],
};

export function isTargetScopedModuleReplacement(
  current: BaselineDraft[ReportModuleType],
  replacement: BaselineDraft[ReportModuleType],
  target: ReportItemTarget,
): boolean {
  const currentProjection = withoutTarget(current, target, true);
  const replacementProjection = withoutTarget(replacement, target, false);
  return currentProjection !== undefined
    && replacementProjection !== undefined
    && sameJsonValue(currentProjection, replacementProjection);
}

export function reportModuleSourceIds(
  moduleType: ReportModuleType,
  payload: BaselineDraft[ReportModuleType],
): string[] {
  const sourceIds = new Set<string>();
  collectSourceIdFields(payload, sourceIds);

  if (moduleType === "sources") {
    const rawPayload = payload as unknown as Record<string, unknown>;
    const sources = rawPayload.sources;
    if (Array.isArray(sources)) {
      sources.forEach((source) => {
        const sourceId = itemId(source);
        if (sourceId) sourceIds.add(sourceId);
      });
    }
  }

  return [...sourceIds];
}

function withoutTarget(
  payload: BaselineDraft[ReportModuleType],
  target: ReportItemTarget,
  requireTarget: boolean,
): Record<string, unknown> | undefined {
  if (!targetSections[target.moduleType].includes(target.section)) return undefined;
  if (!parseModulePayload(target.moduleType, payload)) return undefined;
  const rawPayload = payload as unknown as Record<string, unknown>;
  const items = rawPayload[target.section];
  if (!Array.isArray(items)) return undefined;

  let matches = 0;
  const remaining = items.filter((item) => {
    const matchesTarget = target.moduleType === "sources" && target.section === "relations"
      ? relationTargetId(item) === target.itemId
      : itemId(item) === target.itemId;
    if (matchesTarget) matches += 1;
    return !matchesTarget;
  });
  if (matches > 1 || (requireTarget && matches !== 1)) return undefined;
  return { ...rawPayload, [target.section]: remaining };
}

function parseModulePayload(
  moduleType: ReportModuleType,
  payload: BaselineDraft[ReportModuleType],
): Record<string, unknown> | undefined {
  const parsed = {
    overview: overviewModuleSchema,
    argument: argumentModuleSchema,
    perspectives: perspectivesModuleSchema,
    sources: sourcesModuleSchema,
    risks: risksModuleSchema,
    reflection: reflectionModuleSchema,
  }[moduleType].safeParse(payload);
  return parsed.success
    ? parsed.data as unknown as Record<string, unknown>
    : undefined;
}

function itemId(item: unknown): string | undefined {
  return isRecord(item) && typeof item.id === "string" ? item.id : undefined;
}

function relationTargetId(item: unknown): string | undefined {
  return isRecord(item)
    && typeof item.claimId === "string"
    && typeof item.sourceId === "string"
    ? `${item.claimId}:${item.sourceId}`
    : undefined;
}

function collectSourceIdFields(value: unknown, sourceIds: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectSourceIdFields(item, sourceIds));
    return;
  }
  if (!isRecord(value)) return;
  Object.entries(value).forEach(([key, item]) => {
    if (key === "sourceId" && typeof item === "string") {
      sourceIds.add(item);
      return;
    }
    collectSourceIdFields(item, sourceIds);
  });
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length
      && left.every((value, index) => sameJsonValue(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) =>
      key === rightKeys[index] && sameJsonValue(left[key], right[key])
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveReportItemTarget(
  modules: AnalysisSnapshot["modules"],
  target: ReportItemTarget,
): boolean {
  const payload = modules[target.moduleType]?.payload;
  if (!payload) return false;

  switch (target.moduleType) {
    case "overview": {
      const parsed = overviewModuleSchema.safeParse(payload);
      if (!parsed.success) return false;
      const items = target.section === "coreClaims"
        ? parsed.data.coreClaims
        : target.section === "mainDisputes"
          ? parsed.data.mainDisputes
          : target.section === "topRisks"
            ? parsed.data.topRisks
            : target.section === "keyUnknowns"
              ? parsed.data.keyUnknowns
              : undefined;
      return hasOneId(items, target.itemId);
    }
    case "argument": {
      const parsed = argumentModuleSchema.safeParse(payload);
      if (!parsed.success) return false;
      const items = target.section === "claims"
        ? parsed.data.claims
        : target.section === "evidence"
          ? parsed.data.evidence
          : target.section === "assumptions"
            ? parsed.data.assumptions
            : target.section === "reasoningSteps"
              ? parsed.data.reasoningSteps
              : target.section === "conclusions"
                ? parsed.data.conclusions
                : target.section === "gaps"
                  ? parsed.data.gaps
                  : target.section === "factualStatements"
                    ? parsed.data.factualStatements
                    : undefined;
      return hasOneId(items, target.itemId);
    }
    case "perspectives": {
      const parsed = perspectivesModuleSchema.safeParse(payload);
      if (!parsed.success) return false;
      const items = target.section === "supporting"
        ? parsed.data.supporting
        : target.section === "opposing"
          ? parsed.data.opposing
          : target.section === "stakeholders"
            ? parsed.data.stakeholders
            : target.section === "disputes"
              ? parsed.data.disputes
              : target.section === "unknowns"
                ? parsed.data.unknowns
                : target.section === "changeEvidence"
                  ? parsed.data.changeEvidence
                  : undefined;
      return hasOneId(items, target.itemId);
    }
    case "sources": {
      const parsed = sourcesModuleSchema.safeParse(payload);
      if (!parsed.success) return false;
      if (target.section === "gaps") return hasOneId(parsed.data.gaps, target.itemId);
      if (target.section !== "relations") return false;
      const matches = parsed.data.relations.filter(
        (relation) => `${relation.claimId}:${relation.sourceId}` === target.itemId,
      );
      if (matches.length !== 1) return false;
      const [relation] = matches;
      return hasOneId(parsed.data.claims, relation.claimId)
        && hasOneId(parsed.data.sources, relation.sourceId);
    }
    case "risks": {
      const parsed = risksModuleSchema.safeParse(payload);
      return parsed.success && target.section === "items" && hasOneId(parsed.data.items, target.itemId);
    }
    case "reflection":
      return false;
  }
}

function hasOneId(items: readonly { id: string }[] | undefined, id: string): boolean {
  return (items?.filter((item) => item.id === id).length ?? 0) === 1;
}

export type { AnalysisJobStatus, ReportModuleStatus } from "./job-state";
