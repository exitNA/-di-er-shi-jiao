import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, migrateTestDb, testDatabaseUrl, truncateTestDbFor } from "../../helpers/database";

describe("MVP schema", () => {
  const db = createTestDb();
  beforeAll(() => migrateTestDb());

  it("uses the dedicated test container URL", () => {
    expect(testDatabaseUrl()).toBe("postgres://app:app@127.0.0.1:54330/second_perspective_test");
  });

  it("rejects a non-test DATABASE_URL", () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    try {
      process.env.DATABASE_URL = "postgres://app:app@127.0.0.1:54329/second_perspective";
      expect(() => testDatabaseUrl()).toThrow("Refusing to truncate a non-test database");
    } finally {
      if (originalDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = originalDatabaseUrl;
      }
    }
  });

  it("rejects a non-test URL when truncating", async () => {
    await expect(truncateTestDbFor("postgres://app:app@127.0.0.1:54329/second_perspective")).rejects.toThrow(
      "Refusing to truncate a non-test database",
    );
  });

  it("creates all baseline tables", async () => {
    const result = await db.execute<{ table_name: string }>(sql`
      select table_name from information_schema.tables
      where table_schema = 'public'
    `);
    expect(result.rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining([
        "users",
        "password_credentials",
        "sessions",
        "auth_rate_limits",
        "analysis_materials",
        "analysis_jobs",
        "agent_runs",
        "agent_tool_calls",
        "expert_runs",
        "reports",
        "report_modules",
        "report_sources",
        "analysis_events",
        "product_events",
      ]),
    );
  });
});
