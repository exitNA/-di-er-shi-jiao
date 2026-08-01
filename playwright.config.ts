import { defineConfig, devices } from "@playwright/test";

const testDatabaseUrl =
  "postgres://app:app@127.0.0.1:54329/second_perspective_test";
const baseUrl = "http://127.0.0.1:3100";

process.env.TEST_DATABASE_URL ??= testDatabaseUrl;

export default defineConfig({
  testDir: "./tests/e2e",
  expect: { timeout: 15_000 },
  globalSetup: "./tests/e2e/global.setup.ts",
  use: {
    baseURL: baseUrl,
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
    command: "pnpm build && NODE_ENV=production DEPLOY_RUN_PORT=3100 pnpm start",
    url: baseUrl,
    timeout: 180_000,
    env: {
      APP_URL: baseUrl,
      DATABASE_URL: testDatabaseUrl,
      TEST_DATABASE_URL: testDatabaseUrl,
      AUTH_SECRET: "test-auth-secret-that-is-at-least-32-bytes",
      AGENT_ADAPTER: "fake",
      ANALYSIS_RUNTIME: "in-process",
      E2E_TEST_MODE: "true",
    },
  },
});
