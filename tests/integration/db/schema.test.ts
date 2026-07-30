import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, migrateTestDb } from "../../helpers/database";

describe("MVP schema", () => {
  const db = createTestDb();
  beforeAll(() => migrateTestDb());

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
