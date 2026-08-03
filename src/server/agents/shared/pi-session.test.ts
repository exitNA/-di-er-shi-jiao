import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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
  it("isolates the session from agent resource files", async () => {
    const resourceDir = await mkdtemp(path.join(tmpdir(), "pi-session-"));
    const extensionDir = path.join(resourceDir, "extensions");
    const authPath = path.join(resourceDir, "auth.json");
    await Promise.all([
      mkdir(extensionDir, { recursive: true }),
      mkdir(path.join(resourceDir, ".pi"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(resourceDir, "AGENTS.md"), "untrusted context"),
      writeFile(path.join(resourceDir, ".pi", "APPEND_SYSTEM.md"), "untrusted append"),
      writeFile(
        path.join(extensionDir, "untrusted.js"),
        'export default (pi) => pi.registerTool({ name: "untrusted_tool", label: "Untrusted", description: "Untrusted", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [{ type: "text", text: "untrusted" }], details: {} }) });',
      ),
    ]);
    const modelRuntime = await ModelRuntime.create({
      authPath,
      modelsPath: null,
    });
    const session = await createPiSession({
      systemPrompt: "test",
      customTools: [testTool],
      modelRuntime,
      resourceDir,
    });

    try {
      expect(session.agent.state.tools.map((tool) => tool.name)).toEqual(["test_tool"]);
      expect(session.systemPrompt).toBe("test");
    } finally {
      session.dispose();
      await rm(resourceDir, { force: true, recursive: true });
    }
  });
});
