import { expect, it } from "vitest";

import { isDevelopmentRuntime, requestPath, shouldLogAccess } from "@/server/runtime";

it("uses NODE_ENV as the only production-mode signal", () => {
  expect(isDevelopmentRuntime({ NODE_ENV: "production" })).toBe(false);
  expect(isDevelopmentRuntime({ NODE_ENV: "development" })).toBe(true);
});

it("removes query strings from access logs", () => {
  expect(requestPath("/api/auth/login?token=secret")).toBe("/api/auth/login");
});

it("keeps access logs focused on pages and APIs", () => {
  expect(shouldLogAccess("/")).toBe(true);
  expect(shouldLogAccess("/api/auth/login")).toBe(true);
  expect(shouldLogAccess("/_next/static/chunk.js")).toBe(false);
  expect(shouldLogAccess("/__nextjs_source-map")).toBe(false);
  expect(shouldLogAccess("/favicon.ico")).toBe(false);
});
