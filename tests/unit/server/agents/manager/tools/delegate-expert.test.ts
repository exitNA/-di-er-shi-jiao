import { describe, expect, it, vi } from "vitest";

import { createDelegateExpertTool } from "@/server/agents/manager/tools/delegate-expert";

describe("createDelegateExpertTool", () => {
  it("delegates to a selected peer without exposing workspace identifiers", async () => {
    const workspaceId = "workspace-secret";
    const runExpert = vi.fn(async () => ({
      ok: true as const,
      summary: `reviewed ${workspaceId}`,
    }));
    const delegateExpert = createDelegateExpertTool({
      workspaceId,
      agentRunId: "run-1",
      runExpert,
    });

    const result = await delegateExpert.execute(
      "call",
      { expert: "risks", task: "review claims" },
      undefined,
      undefined,
      undefined as never,
    );

    expect(runExpert).toHaveBeenCalledWith(expect.objectContaining({
      expert: "risks",
      task: "review claims",
      workspaceId,
    }));
    const content = result.content[0];
    expect(content?.type === "text" ? content.text : "").not.toContain(workspaceId);
  });
});
