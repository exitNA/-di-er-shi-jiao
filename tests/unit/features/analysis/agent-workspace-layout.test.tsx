import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";

import { AgentWorkspaceLayout } from "@/features/analysis/components/agent-workspace-layout";

it("adjusts the desktop split with the keyboard", async () => {
  render(<AgentWorkspaceLayout conversation={<p>对话</p>} findings={<p>发现</p>} />);

  const separator = screen.getByRole("separator", { name: "调整对话与发现区域宽度" });
  expect(separator).toHaveAttribute("aria-valuenow", "38");
  separator.focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(separator).toHaveAttribute("aria-valuenow", "40");
});
