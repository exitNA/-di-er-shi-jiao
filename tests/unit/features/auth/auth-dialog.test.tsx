import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { AuthDialog } from "@/features/auth/components/auth-dialog";

const mocks = vi.hoisted(() => ({
  logger: { info: vi.fn(), warning: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@logtape/logtape", () => ({ getLogger: () => mocks.logger }));

it("opens login and switches to registration", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  render(<AuthDialog />);

  await user.click(screen.getByRole("button", { name: "登录" }));
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/auth/diagnostics",
    expect.objectContaining({ body: JSON.stringify({ event: "login_clicked" }) }),
  );
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "登录" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "创建账号" }));
  expect(screen.getByRole("heading", { name: "创建账号" })).toBeInTheDocument();
});

it("opens even when console logging fails", async () => {
  const user = userEvent.setup();
  mocks.logger.info.mockImplementationOnce(() => {
    throw new Error("Console Bridge unavailable");
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
  render(<AuthDialog />);

  await user.click(screen.getByRole("button", { name: "登录" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});
