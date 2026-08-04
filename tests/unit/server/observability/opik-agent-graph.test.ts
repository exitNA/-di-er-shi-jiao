import { describe, expect, it } from "vitest";

import { OpikAgentGraph } from "@/server/observability/opik-agent-graph";

describe("OpikAgentGraph", () => {
  it("renders distinct child nodes, states, durations, and parent edges without input", () => {
    const graph = new OpikAgentGraph();
    const manager = graph.start({ name: "manager", type: "chain" });
    const firstGeneration = graph.start({
      name: "pi.generation",
      type: "generation",
      parentId: manager,
    });
    const secondGeneration = graph.start({
      name: "pi.generation",
      type: "generation",
      parentId: manager,
    });

    graph.end(firstGeneration, { state: "completed", durationMs: 120 });
    graph.end(secondGeneration, { state: "failed", durationMs: 45 });
    graph.end(secondGeneration, { state: "completed", durationMs: 1 });

    const definition = graph.definition();

    expect(manager).toBe("n1");
    expect(firstGeneration).toBe("n2");
    expect(secondGeneration).toBe("n3");
    expect(firstGeneration).not.toBe(secondGeneration);
    expect(definition.format).toBe("mermaid");
    expect(definition.data).toMatch(/^flowchart TD/m);
    expect(definition.data).toContain(`${manager} --> ${firstGeneration}`);
    expect(definition.data).toContain(`${manager} --> ${secondGeneration}`);
    expect(definition.data).toContain("completed · 120ms");
    expect(definition.data).toContain("failed · 45ms");
    expect(definition.data).toContain(`class ${firstGeneration} completed`);
    expect(definition.data).toContain(`class ${secondGeneration} failed`);
    expect(definition.data).not.toContain("secret input");
  });

  it("escapes Mermaid label text and includes every state style", () => {
    const graph = new OpikAgentGraph();
    const running = graph.start({ name: 'manager["x"]', type: "chain" });
    const cancelled = graph.start({ name: "worker", type: "tool" });
    graph.end(cancelled, { state: "cancelled", durationMs: 4 });

    const { data } = graph.definition();

    expect(data).toContain('manager\\[&quot;x&quot;\\]');
    expect(data).toContain(`class ${running} running`);
    expect(data).toMatch(/classDef running /);
    expect(data).toMatch(/classDef completed /);
    expect(data).toMatch(/classDef cancelled /);
    expect(data).toMatch(/classDef failed /);
  });
});
