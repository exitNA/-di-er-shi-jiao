import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { AgentProcessTimeline } from "@/features/analysis/components/agent-process-timeline";
import type { AgentProcessState } from "@/features/analysis/hooks/use-analysis-stream";

it("renders nested Agent activity with real reasoning and redacted tool details", async () => {
  render(<AgentProcessTimeline process={process()} />);

  expect(screen.getByRole("region", { name: "Agent 过程" })).toBeVisible();
  expect(screen.getByText("客户经理")).toBeVisible();
  expect(screen.getByText("比较两组证据后再下结论。")).toBeVisible();
  expect(screen.getByText((_, element) => element?.textContent === '输入：{"query":"原始材料"}\n输出：找到两条来源')).toBeVisible();
  expect(screen.getByText("模型输出")).toBeVisible();
  expect(screen.getByText("模型推理")).toBeVisible();
  expect(screen.getByText("工具")).toBeVisible();
  expect(screen.getByText("输出")).toBeVisible();
  expect(screen.getByText("信源研究 Agent")).toBeVisible();
});

function process(): AgentProcessState {
  return {
    runs: [
      {
        id: "main",
        name: "客户经理",
        status: "running",
        steps: [
          {
            id: "step:核对",
            name: "核对",
            status: "running",
            entries: [
              { id: "r", kind: "reasoning", content: "比较两组证据后再下结论。", status: "completed" },
              { id: "t", kind: "tool", title: "search", content: '输入：{"query":"原始材料"}\n输出：找到两条来源', status: "completed" },
              { id: "o", kind: "text", content: "模型输出", status: "running" },
            ],
          },
        ],
      },
      {
        id: "child",
        parentRunId: "main",
        name: "信源研究 Agent",
        status: "completed",
        steps: [{ id: "step:研究", name: "研究", status: "completed", entries: [] }],
      },
    ],
  };
}
