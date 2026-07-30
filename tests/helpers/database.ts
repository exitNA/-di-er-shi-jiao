import path from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { loadServerEnv } from "@/server/config/env";
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

function testDatabaseUrl(): string {
  const { TEST_DATABASE_URL } = loadServerEnv();
  if (!TEST_DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL is required");
  }
  return TEST_DATABASE_URL;
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
  const connectionString = testDatabaseUrl();
  const databaseName = new URL(connectionString).pathname.slice(1);
  if (!databaseName.endsWith("_test")) {
    throw new Error("Refusing to truncate a non-test database");
  }

  const pool = new Pool({ connectionString });
  try {
    await pool.query(`TRUNCATE TABLE ${applicationTables.join(", ")} RESTART IDENTITY CASCADE`);
  } finally {
    await pool.end();
  }
}
