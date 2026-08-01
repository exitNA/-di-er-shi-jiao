import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { AuthDialog } from "@/features/auth/components/auth-dialog";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

it("opens login and switches to registration", async () => {
  const user = userEvent.setup();
  render(<AuthDialog />);

  await user.click(screen.getByRole("button", { name: "登录" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "登录" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "创建账号" }));
  expect(screen.getByRole("heading", { name: "创建账号" })).toBeInTheDocument();
});
