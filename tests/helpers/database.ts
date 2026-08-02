import path from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb, type AppDb } from "@/server/db/client";

const applicationTables = [
  "users",
  "password_credentials",
  "sessions",
  "auth_rate_limits",
  "analysis_materials",
  "analysis_jobs",
  "expert_runs",
  "reports",
  "report_modules",
  "report_sources",
  "analysis_events",
  "product_events",
].map((table) => `\"${table}\"`);

export function testDatabaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) {
    throw new Error("DATABASE_URL is required");
  }
  assertTestDatabaseUrl(value);
  return value;
}

function assertTestDatabaseUrl(connectionString: string): void {
  const databaseName = new URL(connectionString).pathname.slice(1);
  if (!databaseName.endsWith("_test")) {
    throw new Error("Refusing to truncate a non-test database");
  }
}

export function createTestDb(): AppDb {
  return createDb(testDatabaseUrl());
}

export async function migrateTestDb(): Promise<void> {
  const pool = new Pool({ connectionString: testDatabaseUrl() });
  try {
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    });
  } finally {
    await pool.end();
  }
}

export async function truncateTestDb(): Promise<void> {
  await truncateTestDbFor(testDatabaseUrl());
}

export async function truncateTestDbFor(connectionString: string): Promise<void> {
  assertTestDatabaseUrl(connectionString);

  const pool = new Pool({ connectionString });
  try {
    await pool.query(`TRUNCATE TABLE ${applicationTables.join(", ")} RESTART IDENTITY CASCADE`);
  } finally {
    await pool.end();
  }
}
