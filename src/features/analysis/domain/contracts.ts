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

export type AnalysisSnapshot = {
  jobId: string;
  status: AnalysisJobStatus;
  configVersion: string;
  materialPreview: string;
  createdAt: string;
  updatedAt: string;
  lastEventId: number;
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

export type { AnalysisJobStatus, ReportModuleStatus } from "./job-state";
