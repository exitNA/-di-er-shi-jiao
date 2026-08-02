import { describe, expect, it } from "vitest";
import {
  assertJobTransition,
  assertModuleTransition,
  canTransitionJob,
  canTransitionModule,
} from "@/features/analysis/domain/job-state";

describe("analysis job state transitions", () => {
  it("allows recoverable to running but rejects completed to queued", () => {
    expect(canTransitionJob("recoverable", "running")).toBe(true);
    expect(canTransitionJob("completed", "queued")).toBe(false);
  });

  it("allows a partial job to complete", () => {
    expect(canTransitionJob("partial", "completed")).toBe(true);
  });

  it("allows active and recoverable workspaces to be interrupted and resumed", () => {
    expect(canTransitionJob("queued", "interrupted")).toBe(true);
    expect(canTransitionJob("running", "interrupted")).toBe(true);
    expect(canTransitionJob("partial", "interrupted")).toBe(true);
    expect(canTransitionJob("recoverable", "interrupted")).toBe(true);
    expect(canTransitionJob("interrupted", "running")).toBe(true);
  });

  it("throws for an invalid job transition", () => {
    expect(() => assertJobTransition("queued", "completed")).toThrow(
      /queued.*completed/,
    );
  });
});

describe("report module state transitions", () => {
  it("retries a failed module", () => {
    expect(canTransitionModule("failed", "running")).toBe(true);
  });

  it("requires revision permission to reopen a completed module", () => {
    expect(canTransitionModule("completed", "running")).toBe(false);
    expect(canTransitionModule("completed", "running", true)).toBe(true);
    expect(() => assertModuleTransition("completed", "running")).toThrow(
      /completed.*running/,
    );
  });
});
