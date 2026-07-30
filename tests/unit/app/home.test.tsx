import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import Home from "@/app/page";

vi.mock("@/features/auth/server/current-user", () => ({
  getCurrentUser: vi.fn().mockResolvedValue({
    id: "user-1",
    username: "tester",
  }),
}));
vi.mock("@/features/analysis/components/analysis-form", () => ({
  AnalysisForm: () => <div>分析表单</div>,
}));

it("shows the product promise", async () => {
  render(await Home());
  expect(
    screen.getByRole("heading", { name: /帮你弄懂复杂议题/ }),
  ).toBeInTheDocument();
});
