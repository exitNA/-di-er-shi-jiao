import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

it("shows branded navigation for an authenticated reader", async () => {
  render(await Home());

  expect(screen.getByLabelText("第二视角")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "首页" })).toHaveAttribute(
    "href",
    "/",
  );
  expect(screen.getByRole("link", { name: "历史记录" })).toHaveAttribute(
    "href",
    "/history",
  );

  await userEvent.click(screen.getByRole("button", { name: "打开账户菜单" }));
  expect(screen.getByText("tester")).toBeInTheDocument();
});
