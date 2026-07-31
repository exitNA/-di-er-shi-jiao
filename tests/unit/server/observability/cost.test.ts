import { describe, expect, it } from "vitest";

import {
  calculateTokenCostUsd,
  formatTokenCostUsd,
} from "@/server/observability/cost";

describe("token cost accounting", () => {
  it("uses configured input and output prices per million tokens", () => {
    const cost = calculateTokenCostUsd(1_000, 500, {
      inputUsdPerMillion: 2,
      outputUsdPerMillion: 4,
    });

    expect(cost).toBe(0.004);
    expect(formatTokenCostUsd(cost)).toBe("0.004000");
  });
});
