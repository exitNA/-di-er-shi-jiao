import { describe, expect, it } from "vitest";
import { runLlmProbe } from "../../scripts/probe-llm";

describe("Pi Agent capabilities", () => {
  it.skipIf(process.env.RUN_LLM_CONTRACTS !== "1")(
    "supports schema-validated tools and streaming events",
    async () => {
      const result = await runLlmProbe();

      expect(result.modelId).not.toBe("");
      expect(result.structuredOutput).toBe(true);
      expect(result.toolCall).toBe(true);
      expect(result.streamedEvents).toBe(true);
    },
  );
});
