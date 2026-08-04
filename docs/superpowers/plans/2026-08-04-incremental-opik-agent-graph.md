# Incremental Opik Agent Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render every analysis run's actual execution DAG in Opik while preserving equivalent Langfuse and Opik observations.

**Architecture:** A runtime graph is created with each Opik root trace. `startObservation` adds an actual instance node from the existing OpenTelemetry parent context; end finalizes its state. The graph is serialized as Mermaid into Opik trace metadata after each structural change. Existing native SDK writes remain the single source for common fields.

**Tech Stack:** Next.js 16, TypeScript, Opik SDK, Langfuse v5, OpenTelemetry API, Vitest.

## Global Constraints

- Record every observation instance; never merge same-name calls.
- Graph labels contain only operation name, type, ordinal, state and duration: no payload, prompt, output, identity or tool arguments.
- Preserve common name, type, parentage, I/O, metadata, model, token, cost, error and cancellation data in both platforms.
- `_opik_graph_definition` is Opik-only additive metadata.
- Update graph only on observation start, end and error.

---

### Task 1: Runtime graph model

**Files:** Create `src/server/observability/opik-agent-graph.ts`; test `tests/unit/server/observability/opik-agent-graph.test.ts`.

**Interfaces:** `OpikAgentGraph.start({ name, type, parentId? })` returns Mermaid-safe stable node ID. `end(id, { state, durationMs })` is idempotent. `definition()` returns `{ format: "mermaid", data: string }`. States are `completed`, `cancelled`, `failed`.

- [ ] Write a failing test that creates one manager and two `pi.generation` children, ends one successfully and one as failed, then asserts two distinct node IDs, both parent edges, Mermaid format, duration labels and no input content.
- [ ] Run `pnpm vitest run tests/unit/server/observability/opik-agent-graph.test.ts`; expect a missing-module failure.
- [ ] Implement a self-contained `OpikAgentGraph` that allocates `n1`, `n2`, records start/end state, escapes Mermaid label text, outputs `flowchart TD`, and emits classes for running/completed/cancelled/failed.
- [ ] Run the same test; expect PASS.
- [ ] Commit only the implementation and test with `git commit -m "feat: model incremental Opik agent graphs"`.

### Task 2: Bind graph updates to dual observations

**Files:** Modify `src/server/observability/observations.ts`; modify `tests/unit/server/observability/observations.test.ts`.

**Interfaces:** Task 2 consumes `OpikAgentGraph`. Each active OTel span maps to `{ opikParent, graph, nodeId, rootTrace, traceMetadata, startedAt }`. Root metadata is always `{ ...traceMetadata, _opik_graph_definition: graph.definition() }`.

- [ ] Write a failing test that runs a manager with a nested generation and asserts `opik.trace.update` receives `_opik_graph_definition` at least once before end and again after end; assert current Langfuse observation names, types and output remain unchanged.
- [ ] Run `pnpm vitest run tests/unit/server/observability/observations.test.ts`; expect the graph-metadata assertion to fail.
- [ ] In `withAnalysisTrace`, create graph and root context. In `startObservation`, allocate graph node from the same active OTel parent used for native Opik span nesting, record start time, then update root trace metadata. In `end`, calculate duration and classify `Error` as failed, `WARNING` cancellation as cancelled, all other outcomes as completed; update root metadata before ending native targets. Leave `updateOpik` name/type/I-O/metadata/model/usage/cost/error mappings intact.
- [ ] Run `pnpm vitest run tests/unit/server/observability/observations.test.ts tests/unit/server/observability/opik-agent-graph.test.ts`; expect PASS.
- [ ] Commit only observation implementation and test with `git commit -m "feat: update Opik graph during analysis runs"`.

### Task 3: Document and verify the operator path

**Files:** Modify `docs/operations/mvp-baseline.md`; modify `tests/unit/scripts/opik.test.ts`.

**Interfaces:** Consumes root trace metadata from Task 2. Produces manual verification for Opik's `Show Agent Graph` sidebar action.

- [ ] Write a failing assertion that `docs/operations/mvp-baseline.md` contains `Show Agent Graph` and `_opik_graph_definition`.
- [ ] Run `pnpm vitest run tests/unit/scripts/opik.test.ts`; expect failure.
- [ ] Add concise Chinese instructions: start baseline analysis, open corresponding Opik trace, select `Show Agent Graph`, refresh during execution, compare repeated/failed/completed nodes with span tree, and note labels omit sensitive payloads.
- [ ] Run `pnpm vitest run tests/unit/server/observability/observations.test.ts tests/unit/server/observability/opik-agent-graph.test.ts tests/unit/scripts/opik.test.ts && pnpm lint && pnpm typecheck`; expect all green.
- [ ] Run a nested local Opik SDK trace plus `flush()` against `http://localhost:5173/api`; expect no 500.
- [ ] Commit only document and assertion with `git commit -m "docs: verify incremental Opik agent graphs"`.

## Plan Self-Review

- Task 1 covers actual-instance dynamic DAG data.
- Task 2 covers incremental Opik updates and protects the complete Langfuse/Opik common-field contract.
- Task 3 covers local UI and transport verification.
- Interfaces and names are consistent; no task leaves an unspecified behavior.
