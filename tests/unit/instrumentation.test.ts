import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configure: vi.fn(async () => undefined),
  getAnsiColorFormatter: vi.fn(() => vi.fn()),
  getConsoleSink: vi.fn(() => ({})),
  startObservability: vi.fn(async () => undefined),
}));

vi.mock("@logtape/logtape", () => ({
  configure: mocks.configure,
  getAnsiColorFormatter: mocks.getAnsiColorFormatter,
  getConsoleSink: mocks.getConsoleSink,
}));

vi.mock("@/server/observability/tracing", () => ({
  startObservability: mocks.startObservability,
}));

import { register } from "@/instrumentation";

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

it("skips observability during the production build phase", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NEXT_PHASE", "phase-production-build");

  await register();

  expect(mocks.configure).not.toHaveBeenCalled();
  expect(mocks.startObservability).not.toHaveBeenCalled();
});

it("starts observability in a Node runtime phase", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NEXT_PHASE", "phase-production-server");

  await register();

  expect(mocks.configure).toHaveBeenCalledOnce();
  expect(mocks.startObservability).toHaveBeenCalledOnce();
});
