import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { AnalysisForm } from "@/features/analysis/components/analysis-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

it("offers an enabled second-perspective action for supplied content", () => {
  render(<AnalysisForm content="一段待分析的观点" compact />);

  expect(
    screen.getByRole("button", { name: "展开第二视角" }),
  ).toBeEnabled();
});
