import { migrateTestDb, truncateTestDb } from "../helpers/database";

export default async function globalSetup() {
  await migrateTestDb();
  await truncateTestDb();
}
