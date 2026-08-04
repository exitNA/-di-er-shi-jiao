type OpikAgentGraphState = "running" | "completed" | "cancelled" | "failed";

type GraphNode = {
  id: string;
  name: string;
  type: string;
  state: OpikAgentGraphState;
  durationMs?: number;
  parentId?: string;
};

export class OpikAgentGraph {
  private readonly nodes: GraphNode[] = [];

  start({ name, type, parentId }: { name: string; type: string; parentId?: string }): string {
    const id = `n${this.nodes.length + 1}`;
    this.nodes.push({ id, name, type, state: "running", parentId });
    return id;
  }

  end(id: string, { state, durationMs }: { state: Exclude<OpikAgentGraphState, "running">; durationMs: number }): void {
    const node = this.nodes.find((candidate) => candidate.id === id);
    if (!node || node.state !== "running") return;

    node.state = state;
    node.durationMs = durationMs;
  }

  definition(): { format: "mermaid"; data: string } {
    const data = [
      "flowchart TD",
      ...this.nodes.map((node, index) => `  ${node.id}["${this.label(node, index + 1)}"]`),
      ...this.nodes
        .filter((node) => node.parentId)
        .map((node) => `  ${node.parentId} --> ${node.id}`),
      ...this.nodes.map((node) => `  class ${node.id} ${node.state}`),
      "  classDef running fill:#dbeafe,stroke:#2563eb",
      "  classDef completed fill:#dcfce7,stroke:#16a34a",
      "  classDef cancelled fill:#fef3c7,stroke:#d97706",
      "  classDef failed fill:#fee2e2,stroke:#dc2626",
    ].join("\n");

    return { format: "mermaid", data };
  }

  private label(node: GraphNode, index: number): string {
    const result = node.durationMs === undefined
      ? "running"
      : `${node.state} · ${node.durationMs}ms`;
    return `${escapeMermaidLabel(node.name)}<br/>${escapeMermaidLabel(node.type)} #${index}<br/>${result}`;
  }
}

function escapeMermaidLabel(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replaceAll("|", "\\|")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
