import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "happy-dom",
    setupFiles: "./vitest.setup.ts",
    clearMocks: true,
    exclude: [...configDefaults.exclude, "**/.worktrees/**"],
    coverage: {
      exclude: ["src/trigger/**"],
    },
  },
});
