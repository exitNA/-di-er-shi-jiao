import { and, eq, sql } from "drizzle-orm";

import type { ReportModuleType } from "@/features/analysis/domain/contracts";
import type { AppDb } from "@/server/db/client";
import {
  analysisEvents,
  analysisJobs,
  expertRuns,
  productEvents,
} from "@/server/db/schema/analysis";

export const productEventNames = [
  "analysis_submitted",
  "first_module_shown",
  "baseline_report_completed",
  "report_degraded",
  "report_item_challenged",
  "report_revised",
] as const;

export type ProductEventName = (typeof productEventNames)[number];

export type ProductEventInput =
  | {
      userId: string;
      jobId: string;
      eventName: "analysis_submitted" | "baseline_report_completed";
      now?: Date;
    }
  | {
      userId: string;
      jobId: string;
      eventName: "first_module_shown";
      moduleType: ReportModuleType;
      now?: Date;
    }
  | {
      userId: string;
      jobId: string;
      eventName: "report_degraded";
      moduleType: ReportModuleType;
      moduleVersion: number;
      errorCode: string;
      now?: Date;
    }
  | {
      userId: string;
      jobId: string;
      eventName: "report_item_challenged";
      messageId: string;
      moduleType: ReportModuleType;
      now?: Date;
    }
  | {
      userId: string;
      jobId: string;
      eventName: "report_revised";
      revisionId: string;
      moduleType: ReportModuleType;
      now?: Date;
    };

export type ProductEventRecorder = (
  input: ProductEventInput,
) => Promise<boolean>;

export class ProductEventJobNotOwnedError extends Error {
  constructor() {
    super("Product event job is not owned by the current user");
    this.name = "ProductEventJobNotOwnedError";
  }
}

export async function recordProductEvent(
  db: AppDb,
  input: ProductEventInput,
): Promise<boolean> {
  if (!isProductEventName(input.eventName)) {
    throw new TypeError(`Unknown product event: ${String(input.eventName)}`);
  }

  const [ownedJob] = await db
    .select({ id: analysisJobs.id })
    .from(analysisJobs)
    .where(
      and(
        eq(analysisJobs.id, input.jobId),
        eq(analysisJobs.userId, input.userId),
      ),
    )
    .limit(1);
  if (!ownedJob) throw new ProductEventJobNotOwnedError();

  const [inserted] = await db
    .insert(productEvents)
    .values({
      userId: input.userId,
      jobId: input.jobId,
      eventName: input.eventName,
      eventKey: eventKey(input),
      properties: eventProperties(input),
      createdAt: input.now ?? new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: productEvents.id });
  return Boolean(inserted);
}

export type JobOperationalMetrics = {
  firstModuleLatencyMs: number | null;
  completeLatencyMs: number | null;
  expertSuccessRate: number | null;
  degradedReportRate: 0 | 1;
};

export async function getJobOperationalMetrics(
  db: AppDb,
  userId: string,
  jobId: string,
): Promise<JobOperationalMetrics | null> {
  const [job] = await db
    .select({ createdAt: analysisJobs.createdAt })
    .from(analysisJobs)
    .where(and(eq(analysisJobs.id, jobId), eq(analysisJobs.userId, userId)))
    .limit(1);
  if (!job) return null;

  const [[events], [runs]] = await Promise.all([
    db
      .select({
        firstModuleAt: sql<Date | string | null>`
          min(${analysisEvents.createdAt})
          filter (
            where ${analysisEvents.eventType} = 'module.updated'
              and ${analysisEvents.payload}->>'status' = 'completed'
          )
        `,
        completedAt: sql<Date | string | null>`
          min(${analysisEvents.createdAt})
          filter (
            where ${analysisEvents.eventType} in ('baseline.completed', 'report.degraded')
          )
        `,
        degradedCount: sql<number>`
          count(*) filter (where ${analysisEvents.eventType} = 'report.degraded')
        `,
      })
      .from(analysisEvents)
      .where(
        and(
          eq(analysisEvents.jobId, jobId),
          eq(analysisEvents.userId, userId),
        ),
      ),
    db
      .select({
        total: sql<number>`count(*)`,
        completed: sql<number>`
          count(*) filter (where ${expertRuns.status} = 'completed')
        `,
      })
      .from(expertRuns)
      .where(eq(expertRuns.jobId, jobId)),
  ]);

  const totalRuns = Number(runs.total);
  return {
    firstModuleLatencyMs: elapsed(job.createdAt, events.firstModuleAt),
    completeLatencyMs: elapsed(job.createdAt, events.completedAt),
    expertSuccessRate:
      totalRuns === 0 ? null : Number(runs.completed) / totalRuns,
    degradedReportRate: Number(events.degradedCount) > 0 ? 1 : 0,
  };
}

function isProductEventName(value: unknown): value is ProductEventName {
  return (
    typeof value === "string" &&
    (productEventNames as readonly string[]).includes(value)
  );
}

function eventKey(input: ProductEventInput): string {
  switch (input.eventName) {
    case "report_degraded": return `${input.jobId}:${input.moduleType}:${input.moduleVersion}`;
    case "report_item_challenged": return input.messageId;
    case "report_revised": return input.revisionId;
    default: return input.jobId;
  }
}

function eventProperties(
  input: ProductEventInput,
): Record<string, string | boolean> {
  switch (input.eventName) {
    case "first_module_shown":
      return { moduleType: input.moduleType, browserVisible: true };
    case "report_degraded":
      return {
        moduleType: input.moduleType,
        errorCode: input.errorCode,
      };
    case "report_item_challenged":
    case "report_revised":
      return { moduleType: input.moduleType };
    default:
      return {};
  }
}

function elapsed(
  from: Date | string,
  to: Date | string | null,
): number | null {
  return to ? timestampMs(to) - timestampMs(from) : null;
}

function timestampMs(value: Date | string): number {
  const milliseconds =
    value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError("Invalid database timestamp");
  }
  return milliseconds;
}
