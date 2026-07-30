import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
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
      DATABASE_URL:
        "postgres://app:app@127.0.0.1:54329/second_perspective_test",
      AUTH_SECRET: "test-auth-secret-that-is-at-least-32-bytes",
      AGENT_ADAPTER: "fake",
      ANALYSIS_RUNTIME: "in-process",
    },
  },
});
