import { randomUUID } from "node:crypto";
import {
  bigserial,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import type { ReportItemTarget, ReportRevisionChange } from "@/features/analysis/domain/contracts";

const newId = () => randomUUID();
const now = (name: string) => timestamp(name, { withTimezone: true });

export const analysisMaterials = pgTable("analysis_materials", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  content: text("content").notNull(),
  characterCount: integer("character_count").notNull(),
  detectedLanguage: text("detected_language").notNull(),
  createdAt: now("created_at").notNull().defaultNow(),
});

export const analysisJobs = pgTable(
  "analysis_jobs",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    materialId: uuid("material_id")
      .notNull()
      .references(() => analysisMaterials.id),
    status: text("status").notNull(),
    configVersion: text("config_version").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    triggerRunId: text("trigger_run_id"),
    failureCode: text("failure_code"),
    createdAt: now("created_at").notNull().defaultNow(),
    startedAt: now("started_at"),
    completedAt: now("completed_at"),
    updatedAt: now("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("analysis_jobs_user_id_idempotency_key_unique").on(
      table.userId,
      table.idempotencyKey,
    ),
  ],
);

export const expertRuns = pgTable(
  "expert_runs",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    jobId: uuid("job_id")
      .notNull()
      .references(() => analysisJobs.id),
    expertType: text("expert_type").notNull(),
    phase: text("phase").notNull(),
    status: text("status").notNull(),
    attempt: integer("attempt").notNull(),
    configVersion: text("config_version").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 12, scale: 6 }),
    latencyMs: integer("latency_ms"),
    errorCode: text("error_code"),
    createdAt: now("created_at").notNull().defaultNow(),
    startedAt: now("started_at"),
    completedAt: now("completed_at"),
    updatedAt: now("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("expert_runs_job_id_expert_type_phase_attempt_unique").on(
      table.jobId,
      table.expertType,
      table.phase,
      table.attempt,
    ),
  ],
);

export const reports = pgTable("reports", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  jobId: uuid("job_id")
    .notNull()
    .unique()
    .references(() => analysisJobs.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  baselineVersion: integer("baseline_version").notNull(),
  currentVersion: integer("current_version").notNull(),
  createdAt: now("created_at").notNull().defaultNow(),
  updatedAt: now("updated_at").notNull().defaultNow(),
});

export const conversationMessages = pgTable(
  "conversation_messages",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull(),
    target: jsonb("target").$type<ReportItemTarget>().notNull(),
    content: text("content").notNull(),
    status: text("status").notNull(),
    idempotencyKey: text("idempotency_key"),
    createdAt: now("created_at").notNull().defaultNow(),
    updatedAt: now("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("conversation_messages_report_id_idempotency_key_unique").on(
      table.reportId,
      table.idempotencyKey,
    ),
    index("conversation_messages_report_id_created_at_idx").on(table.reportId, table.createdAt),
  ],
);

export const reportRevisions = pgTable(
  "report_revisions",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id),
    triggeringMessageId: uuid("triggering_message_id")
      .notNull()
      .references(() => conversationMessages.id),
    fromVersion: integer("from_version").notNull(),
    toVersion: integer("to_version").notNull(),
    changes: jsonb("changes").$type<ReportRevisionChange[]>().notNull(),
    status: text("status").notNull(),
    createdAt: now("created_at").notNull().defaultNow(),
    updatedAt: now("updated_at").notNull().defaultNow(),
  },
  (table) => [index("report_revisions_report_id_created_at_idx").on(table.reportId, table.createdAt)],
);

export const reportModules = pgTable(
  "report_modules",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id),
    moduleType: text("module_type").notNull(),
    status: text("status").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    errorCode: text("error_code"),
    version: integer("version").notNull(),
    createdAt: now("created_at").notNull().defaultNow(),
    updatedAt: now("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("report_modules_report_id_module_type_unique").on(
      table.reportId,
      table.moduleType,
    ),
  ],
);

export const reportSources = pgTable(
  "report_sources",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id),
    sourceKey: text("source_key").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    canonicalUrl: text("canonical_url"),
    domain: text("domain"),
    publisher: text("publisher"),
    publishedAt: now("published_at"),
    qualityTier: text("quality_tier"),
    excerpt: text("excerpt"),
    createdAt: now("created_at").notNull().defaultNow(),
    updatedAt: now("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("report_sources_report_id_source_key_unique").on(
      table.reportId,
      table.sourceKey,
    ),
  ],
);

export const analysisEvents = pgTable(
  "analysis_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => analysisJobs.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: now("created_at").notNull().defaultNow(),
  },
  (table) => [index("analysis_events_job_id_id_idx").on(table.jobId, table.id)],
);

export const productEvents = pgTable(
  "product_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    jobId: uuid("job_id").references(() => analysisJobs.id),
    eventName: text("event_name").notNull(),
    eventKey: text("event_key").notNull(),
    properties: jsonb("properties").$type<Record<string, unknown>>().notNull(),
    createdAt: now("created_at").notNull().defaultNow(),
  },
  (table) => [
    unique("product_events_user_id_event_name_event_key_unique").on(
      table.userId,
      table.eventName,
      table.eventKey,
    ),
    index("product_events_event_name_created_at_idx").on(
      table.eventName,
      table.createdAt,
    ),
  ],
);
