import { describe, expect, it } from "vitest";
import { runLlmProbe } from "../../scripts/probe-llm";

describe("LLM capabilities", () => {
  it.skipIf(process.env.RUN_LLM_CONTRACTS !== "1")(
    "supports structured output, tools, and streaming",
    async () => {
      const result = await runLlmProbe();

      expect(result.structuredOutput).toBe(true);
      expect(result.toolCall).toBe(true);
      expect(result.streamedText).toBe(true);
    },
  );
});
