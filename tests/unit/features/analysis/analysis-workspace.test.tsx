import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { AnalysisWorkspace } from "@/features/analysis/components/analysis-workspace";
import type {
  AnalysisSnapshot,
  ReportModuleType,
} from "@/features/analysis/domain/contracts";

const mocks = vi.hoisted(() => ({
  retryModule: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/features/analysis/hooks/use-analysis-stream", () => ({
  useAnalysisStream: (_jobId: string, initialSnapshot: AnalysisSnapshot) => ({
    snapshot: initialSnapshot,
    connectionState: initialSnapshot.status === "completed" ? "closed" : "connected",
    retryModule: mocks.retryModule,
  }),
}));

it("renders the six fixed modules in product order with text states", () => {
  const current = snapshot({
    modules: {
      ...emptyModules(),
      argument: { status: "running", version: 1 },
    },
  });
  render(<AnalysisWorkspace initialSnapshot={current} />);

  expect(
    screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent),
  ).toEqual([
    "速览",
    "论证骨架",
    "多视角地图",
    "信源对照",
    "认知风险",
    "思考对话",
  ]);
  expect(screen.getByText("速览等待分析")).toBeInTheDocument();
  expect(screen.getByText("论证骨架分析中")).toBeInTheDocument();
});

it("shows the source failure and retries that module", async () => {
  const current = snapshot({
    status: "partial",
    modules: {
      ...emptyModules(),
      sources: { status: "failed", version: 1, errorCode: "SEARCH_UNAVAILABLE" },
    },
  });
  render(<AnalysisWorkspace initialSnapshot={current} />);

  expect(screen.getByText("信源服务暂时不可用")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "重试信源对照" }));
  expect(mocks.retryModule).toHaveBeenCalledWith("sources");
});

it("uses one polite status region, keeps focus and shows the fixed disclaimer", () => {
  const current = snapshot();
  const { container, rerender } = render(
    <AnalysisWorkspace initialSnapshot={current} />,
  );
  const returnLink = screen.getByRole("link", { name: "返回输入页" });
  returnLink.focus();

  rerender(
    <AnalysisWorkspace
      initialSnapshot={snapshot({ ...current, status: "completed" })}
    />,
  );

  expect(container.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
  expect(returnLink).toHaveFocus();
  expect(screen.getByText("认知体检已完成")).toBeInTheDocument();
  expect(
    screen.getByText(
      "本报告由 AI 生成，旨在提供多角度思考框架。请核对引用，并结合自身知识独立判断。",
    ),
  ).toBeInTheDocument();
});

function snapshot(
  overrides: Partial<AnalysisSnapshot> = {},
): AnalysisSnapshot {
  return {
    jobId: "job-1",
    status: "running",
    configVersion: "baseline-v1",
    materialPreview: "待分析材料",
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
    lastEventId: 0,
    modules: emptyModules(),
    ...overrides,
  };
}

function emptyModules(): AnalysisSnapshot["modules"] {
  return Object.fromEntries(
    (
      [
        "overview",
        "argument",
        "perspectives",
        "sources",
        "risks",
        "reflection",
      ] satisfies ReportModuleType[]
    ).map((moduleType) => [
      moduleType,
      { status: "queued" as const, version: 0 },
    ]),
  ) as AnalysisSnapshot["modules"];
}
