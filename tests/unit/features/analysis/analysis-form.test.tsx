import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { AnalysisForm } from "@/features/analysis/components/analysis-form";

const mocks = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

afterEach(() => vi.unstubAllGlobals());

it("offers an enabled second-perspective action for supplied content", () => {
  render(<AnalysisForm content="一段待分析的观点" compact />);

  expect(
    screen.getByRole("button", { name: "展开第二视角" }),
  ).toBeEnabled();
});

it("submits the report journey with the keyboard", async () => {
  const user = userEvent.setup();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
    Response.json({ jobId: "job-1" }),
  ));
  render(<AnalysisForm compact />);

  await user.tab();
  expect(screen.getByLabelText("想分析的内容")).toHaveFocus();
  await user.keyboard("键盘用户可以完成报告流程。");
  await user.tab();
  expect(screen.getByRole("button", { name: "展开第二视角" })).toHaveFocus();
  await user.keyboard("{Enter}");

  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/analysis/job-1"));
});

it("opens login when an unauthenticated reader submits", async () => {
  const user = userEvent.setup();
  const openLogin = vi.fn();
  window.addEventListener("auth:login", openLogin);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
  render(<AnalysisForm content="一段待分析的观点" compact />);

  await user.click(screen.getByRole("button", { name: "展开第二视角" }));

  await waitFor(() => expect(openLogin).toHaveBeenCalledOnce());
  window.removeEventListener("auth:login", openLogin);
});
