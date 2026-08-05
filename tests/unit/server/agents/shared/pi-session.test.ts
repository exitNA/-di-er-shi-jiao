import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { defineTool, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";

import { createPiSession, createProjectPiModelRuntime } from "@/server/agents/shared/pi-session";

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
  it("maps the supported max reasoning effort", async () => {
    const { model } = await createProjectPiModelRuntime({
      apiKey: "test-key",
      baseURL: "https://llm.example/v1",
      modelId: "test-model",
      inputUsdPerMillion: 0,
      outputUsdPerMillion: 0,
    });

    expect(model.thinkingLevelMap).toMatchObject({
      minimal: null,
      low: "low",
      medium: "low",
      high: "high",
      xhigh: "high",
      max: "max",
    });
  });

  it("isolates the session from agent resource files", async () => {
    const resourceDir = await mkdtemp(path.join(tmpdir(), "pi-session-"));

    try {
      const extensionDir = path.join(resourceDir, "extensions");
      const authPath = path.join(resourceDir, "auth.json");
      await Promise.all([
        mkdir(extensionDir, { recursive: true }),
        mkdir(path.join(resourceDir, ".pi"), { recursive: true }),
        mkdir(path.join(resourceDir, "skills", "local"), { recursive: true }),
      ]);
      await Promise.all([
        writeFile(path.join(resourceDir, "AGENTS.md"), "untrusted context"),
        writeFile(path.join(resourceDir, ".pi", "APPEND_SYSTEM.md"), "untrusted append"),
        writeFile(
          path.join(resourceDir, "skills", "local", "SKILL.md"),
          "---\nname: local-skill\ndescription: trusted local skill\n---\n\nUse local instructions.",
        ),
        writeFile(
          path.join(extensionDir, "untrusted.js"),
          'export default (pi) => pi.registerTool({ name: "untrusted_tool", label: "Untrusted", description: "Untrusted", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [{ type: "text", text: "untrusted" }], details: {} }) });',
        ),
      ]);
      const modelRuntime = await ModelRuntime.create({ authPath, modelsPath: null });
      const model = modelRuntime.getModels("anthropic")[0];
      if (!model) {
        throw new Error("Expected the Anthropic model catalog to be available");
      }
      vi.spyOn(modelRuntime, "getAvailable").mockResolvedValue([model]);
      vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
      const capturedSystemPrompts: string[] = [];
      vi.spyOn(modelRuntime, "streamSimple").mockImplementation((_model, context) => {
        capturedSystemPrompts.push(context.systemPrompt ?? "");
        const message = {
          role: "assistant" as const,
          content: [],
          api: "anthropic-messages" as const,
          provider: "anthropic" as const,
          model: "claude-sonnet-4-5",
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
          stopReason: "stop" as const,
          timestamp: Date.now(),
        };
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: "done" as const, reason: "stop" as const, message };
          },
          result: async () => message,
        } as unknown as ReturnType<ModelRuntime["streamSimple"]>;
      });
      const session = await createPiSession({
        systemPrompt: "test",
        customTools: [testTool],
        modelRuntime,
        model,
        resourceDir,
        reasoningEffort: "off",
      });

      await session.prompt("hello");
      expect(session.agent.state.tools.map((tool) => tool.name)).toEqual(["test_tool"]);
      expect(session.resourceLoader.getSkills().skills.map((skill) => skill.name)).toEqual(["local-skill"]);
      expect(capturedSystemPrompts).toEqual(["test"]);
      session.dispose();
    } finally {
      await rm(resourceDir, { force: true, recursive: true });
    }
  });
});
