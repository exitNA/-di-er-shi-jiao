import { defineConfig, devices } from "@playwright/test";

const testDatabaseUrl =
  "postgres://app:app@127.0.0.1:54329/second_perspective_test";

process.env.TEST_DATABASE_URL ??= testDatabaseUrl;

export default defineConfig({
  testDir: "./tests/e2e",
  expect: { timeout: 15_000 },
  globalSetup: "./tests/e2e/global.setup.ts",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  workers: 1,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:3000",
    env: {
      APP_URL: "http://127.0.0.1:3000",
      DATABASE_URL: testDatabaseUrl,
      TEST_DATABASE_URL: testDatabaseUrl,
      AUTH_SECRET: "test-auth-secret-that-is-at-least-32-bytes",
      AGENT_ADAPTER: "fake",
      ANALYSIS_RUNTIME: "in-process",
    },
  },
});
