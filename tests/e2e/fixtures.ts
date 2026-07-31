import { expect, test as base } from "@playwright/test";
import { truncateTestDb } from "../helpers/database";

export const test = base.extend({
  resetDatabase: [
    async ({}, use) => {
      await truncateTestDb();
      await use();
    },
    { auto: true },
  ],
});

export { expect };
