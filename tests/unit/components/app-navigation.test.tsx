import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";

import { AppNavigation } from "@/components/navigation/app-navigation";

it("submits logout directly from the account menu", async () => {
  const user = userEvent.setup();
  render(<AppNavigation username="tester" />);

  await user.click(screen.getByRole("button", { name: "打开账户菜单" }));
  await user.click(screen.getByRole("button", { name: "退出登录" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
