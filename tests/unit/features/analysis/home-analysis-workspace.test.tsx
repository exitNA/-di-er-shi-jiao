import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { HomeAnalysisWorkspace } from "@/features/analysis/components/home-analysis-workspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

it("prefills a gallery example without submitting", async () => {
  const user = userEvent.setup();
  render(<HomeAnalysisWorkspace />);
  await user.click(screen.getByRole("button", { name: /消费降级真的是因为年轻人没钱了吗/ }));
  expect(screen.getByLabelText("想分析的内容")).toHaveValue("消费降级真的是因为年轻人没钱了吗？");
});
