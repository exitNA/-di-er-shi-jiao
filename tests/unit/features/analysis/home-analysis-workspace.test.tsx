import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { HomeAnalysisWorkspace } from "@/features/analysis/components/home-analysis-workspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

it("prefills a gallery example without submitting", async () => {
  const user = userEvent.setup();
  render(<HomeAnalysisWorkspace />);
  await user.click(
    screen.getByRole("button", { name: /该不该为“情绪价值”多付钱/ }),
  );
  expect(screen.getByLabelText("想分析的内容")).toHaveValue(
    "该不该为“情绪价值”多付钱？",
  );
});
