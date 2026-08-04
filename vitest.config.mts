import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  envDir: false,
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./tests/helpers/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "happy-dom",
    env: {
      OPIK_PROJECT_NAME: "second-perspective",
      OPIK_URL_OVERRIDE: "http://localhost:5173/api",
    },
    setupFiles: "./vitest.setup.ts",
    clearMocks: true,
    exclude: [...configDefaults.exclude, "**/.worktrees/**"],
    coverage: {
      exclude: ["src/trigger/**"],
    },
  },
});
