import { render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import HistoryPage from "@/app/history/page";
import { HistoryList } from "@/features/analysis/components/history-list";
import type { HistoryItem } from "@/features/analysis/server/analysis-repository";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  listOwnedHistory: vi.fn(),
}));

vi.mock("@/features/auth/server/current-user", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock("@/server/container", () => ({
  getContainer: () => ({
    analysisRepository: { listOwnedHistory: mocks.listOwnedHistory },
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

const item = (
  jobId: string,
  status: HistoryItem["status"],
  materialPreview: string,
  createdAt: string,
  completedModuleCount: number,
): HistoryItem => ({ jobId, status, materialPreview, createdAt, completedModuleCount });

beforeEach(() => {
  mocks.getCurrentUser.mockResolvedValue({ id: "owner-id", username: "Reader_1" });
  mocks.listOwnedHistory.mockResolvedValue([]);
});

it("shows newest reports first with status and a resume link", () => {
  render(
    <HistoryList
      items={[
        item("newest", "completed", "较新的报告", "2026-07-30T10:00:00.000Z", 6),
        item("older", "running", "较早的报告", "2026-07-29T10:00:00.000Z", 2),
      ]}
    />,
  );

  const reports = screen.getAllByRole("listitem");
  expect(within(reports[0]).getByText("较新的报告")).toBeInTheDocument();
  expect(within(reports[0]).getByText("已完成")).toBeInTheDocument();
  expect(within(reports[0]).getByRole("link", { name: "继续查看" })).toHaveAttribute(
    "href",
    "/analysis/newest",
  );
  expect(within(reports[1]).getByText("分析中")).toBeInTheDocument();
  expect(within(reports[1]).getByRole("link", { name: "继续查看" })).toHaveAttribute(
    "href",
    "/analysis/older",
  );
});

it("shows an empty-state link back to the input page", () => {
  render(<HistoryList items={[]} />);

  expect(screen.getByText("还没有认知体检报告")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "开始第一次分析" })).toHaveAttribute("href", "/");
});

it("does not expose another user's report", async () => {
  mocks.listOwnedHistory.mockResolvedValue([
    item("owned", "queued", "我的报告", "2026-07-30T10:00:00.000Z", 0),
  ]);

  render(await HistoryPage());

  expect(mocks.listOwnedHistory).toHaveBeenCalledWith("owner-id", 20);
  expect(screen.getByText("我的报告")).toBeInTheDocument();
  expect(screen.queryByText("其他用户的秘密报告")).not.toBeInTheDocument();
});

it("renders partial and recoverable states with precise copy", () => {
  render(
    <HistoryList
      items={[
        item("partial", "partial", "部分报告", "2026-07-30T10:00:00.000Z", 4),
        item("recoverable", "recoverable", "可恢复报告", "2026-07-30T09:00:00.000Z", 3),
      ]}
    />,
  );

  expect(screen.getByText("部分完成")).toBeInTheDocument();
  expect(screen.getByText("待恢复")).toBeInTheDocument();
  expect(screen.getByText("已完成 4 / 6 个模块")).toBeInTheDocument();
  expect(screen.getByText("已完成 3 / 6 个模块")).toBeInTheDocument();
});
