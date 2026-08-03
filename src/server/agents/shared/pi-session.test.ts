import { defineTool, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";

import { createPiSession } from "./pi-session";

const testTool = defineTool({
  name: "test_tool",
  label: "Test tool",
  description: "A test tool.",
  parameters: Type.Object({}),
  async execute() {
    return { content: [{ type: "text" as const, text: "ok" }], details: {} };
  },
});

describe("createPiSession", () => {
  it("creates an in-memory session with only supplied custom tools", async () => {
    const authPath = path.join(process.cwd(), ".pi-test-auth.json");
    const modelRuntime = await ModelRuntime.create({
      authPath,
      modelsPath: null,
    });
    const session = await createPiSession({
      systemPrompt: "test",
      customTools: [testTool],
      modelRuntime,
    });

    try {
      expect(session.agent.state.tools.map((tool) => tool.name)).toEqual(["test_tool"]);
    } finally {
      session.dispose();
      await rm(authPath, { force: true });
    }
  });
});
import { rm } from "node:fs/promises";
import path from "node:path";
