import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";

import { AppNavigation } from "@/components/navigation/app-navigation";

it("submits logout directly from the account menu", async () => {
  const user = userEvent.setup();
  render(<AppNavigation username="tester" />);

  expect(screen.getByLabelText("tester 的头像")).toHaveTextContent("T");

  await user.click(screen.getByRole("button", { name: "打开账户菜单" }));
  await user.click(screen.getByRole("button", { name: "退出登录" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("closes the account menu when clicking outside it", async () => {
  const user = userEvent.setup();
  render(<AppNavigation username="tester" />);

  await user.click(screen.getByRole("button", { name: "打开账户菜单" }));
  expect(screen.getByRole("link", { name: "思考档案" })).toBeInTheDocument();

  await user.click(document.body);

  expect(screen.queryByRole("link", { name: "思考档案" })).not.toBeInTheDocument();
});

it("opens the account menu and reaches history with the keyboard", async () => {
  const user = userEvent.setup();
  render(<AppNavigation username="tester" />);

  await user.tab();
  await user.tab();
  const accountMenu = screen.getByRole("button", { name: "打开账户菜单" });
  expect(accountMenu).toHaveFocus();
  await user.keyboard("{Enter}");
  await user.tab();

  const history = screen.getByRole("link", { name: "思考档案" });
  expect(history).toHaveFocus();
  expect(history).toHaveAttribute("href", "/history");
});
