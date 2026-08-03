# Pi Agent Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed AI SDK manager loop with server-side Pi SDK harnesses for the manager and five peer experts, while keeping Postgres as the product source of truth.

**Architecture:** Every peer owns a Pi `AgentSession`, local prompts, skills and trusted tools. The manager uses Pi custom tools to delegate to peer agents; Postgres services validate every business write and the event bridge translates Pi lifecycle events to existing AG-UI events.

**Tech Stack:** Next.js 16, TypeScript 6, Pi SDK (`@earendil-works/pi-coding-agent`), TypeBox, Zod, Drizzle/Postgres, Vitest, Playwright.

## Global Constraints

- Use `pnpm` only.
- Pi runs server-side only; the browser consumes AG-UI events only.
- Postgres remains authoritative for users, permissions, reports, revisions, runs and events.
- Server tools validate authorization, run state, versions and idempotency before every write.
- Manager chooses peer-agent calls; do not encode a fixed baseline sequence.
- Each agent keeps its prompts, skills, tools, MCP adapters and extensions in its own directory.

---

### Task 1: Add the Pi session factory

**Files:**
- Modify: `package.json`
- Create: `src/server/agents/shared/pi-session.ts`
- Create: `src/server/agents/shared/pi-session.test.ts`

**Interfaces:**
- Produces `createPiSession(input): Promise<AgentSession>`.
- Consumes a system prompt, custom Pi tools and a project-owned `ModelRuntime`.

- [ ] **Step 1: Write the failing test**

```ts
it("creates an in-memory session with only supplied custom tools", async () => {
  const session = await createPiSession({ systemPrompt: "test", customTools: [testTool], modelRuntime });
  expect(session.agent.state.tools.map((tool) => tool.name)).toEqual(["test_tool"]);
  session.dispose();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/server/agents/shared/pi-session.test.ts`

Expected: FAIL because `createPiSession` is missing.

- [ ] **Step 3: Implement the minimal factory**

Run: `pnpm add @earendil-works/pi-coding-agent typebox`

```ts
export async function createPiSession(input: PiSessionInput): Promise<AgentSession> {
  const loader = new DefaultResourceLoader({ systemPromptOverride: () => input.systemPrompt });
  await loader.reload();
  return (await createAgentSession({
    resourceLoader: loader,
    customTools: input.customTools,
    noTools: "all",
    sessionManager: SessionManager.inMemory(),
    modelRuntime: input.modelRuntime,
  })).session;
}
```

Use environment-backed credentials through a project-owned `ModelRuntime`; never read Pi's user-home credential files.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/server/agents/shared/pi-session.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/server/agents/shared/pi-session.ts src/server/agents/shared/pi-session.test.ts
git commit -m "feat: add server Pi session factory"
```

### Task 2: Run experts through a shared Pi harness

**Files:**
- Create: `src/server/agents/shared/expert-harness.ts`
- Create: `src/server/agents/shared/expert-harness.test.ts`
- Modify: `src/server/agents/{argument,sources,perspectives,risks,synthesis}/agent.ts`
- Create: `src/server/agents/{argument,sources,perspectives,risks,synthesis}/skills/*/SKILL.md`

**Interfaces:**
- Produces `createExpertHarness<T>(input).run(request): Promise<ExpertResult<T>>`.
- Consumes an agent-local prompt and Zod result schema.
- Produces one schema-validated result or `{ code: "INVALID_EXPERT_RESULT" }`.

- [ ] **Step 1: Write the failing test**

```ts
it("rejects expert output that misses its result schema", async () => {
  const harness = createExpertHarness({ schema: argumentModuleSchema, session: invalidSession });
  await expect(harness.run({ material: "claim" })).rejects.toMatchObject({ code: "INVALID_EXPERT_RESULT" });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/server/agents/shared/expert-harness.test.ts`

Expected: FAIL because the harness is missing.

- [ ] **Step 3: Implement the Pi completion tool and harness**

```ts
const complete = defineTool({
  name: "complete",
  label: "Complete analysis",
  description: "Submit the final structured result exactly once.",
  parameters: input.typeBoxSchema,
  execute: async (_id, params) => ({ content: [{ type: "text", text: "accepted" }], details: { value: params } }),
});
```

Prompt the session, wait for idle, extract `details.value` from `complete`, then apply the existing Zod schema. Replace direct `StructuredGenerator.generate()` calls in all five agents. Preserve source normalization, the risk-quote filter and existing report artifact shapes.

- [ ] **Step 4: Verify expert behavior**

Run: `pnpm vitest run tests/unit/server/agents/expert-agents.test.ts src/server/agents/shared/expert-harness.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/agents/shared src/server/agents/argument src/server/agents/sources src/server/agents/perspectives src/server/agents/risks src/server/agents/synthesis tests/unit/server/agents/expert-agents.test.ts
git commit -m "feat: run peer experts with Pi harnesses"
```

### Task 3: Make search an agent-local Pi tool

**Files:**
- Modify: `src/server/agents/sources/tools/search.ts`
- Create: `src/server/agents/sources/tools/search.test.ts`
- Modify: `src/server/agents/sources/agent.ts`
- Modify: `src/server/container.ts`

**Interfaces:**
- Produces `createSourceSearchTool(input): AgentTool` with `Type.Object({})` parameters.
- Consumes closure-captured material and the server-owned `SearchTool`; no model-provided identity, URL or provider settings.

- [ ] **Step 1: Write the failing test**

```ts
it("uses the server-owned material to form source queries", async () => {
  await createSourceSearchTool({ searchClient, material: "policy" }).execute("call", {});
  expect(searchClient.search).toHaveBeenCalledWith(expect.objectContaining({ query: expect.stringContaining("policy") }));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/server/agents/sources/tools/search.test.ts`

Expected: FAIL because the tool is missing.

- [ ] **Step 3: Implement and wire the tool**

Use `defineTool`, retain the current candidate cap, URL normalization and escaping. Register it only when the container provides Tavily's `SearchTool`; otherwise the source agent reports no external search capability.

- [ ] **Step 4: Verify source behavior**

Run: `pnpm vitest run src/server/agents/sources/tools/search.test.ts tests/unit/server/agents/expert-agents.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/agents/sources src/server/container.ts tests/unit/server/agents/expert-agents.test.ts
git commit -m "feat: expose source search as a Pi tool"
```

### Task 4: Replace the manager loop with peer-delegation tools

**Files:**
- Modify: `src/server/agents/manager/agent.ts`
- Create: `src/server/agents/manager/tools/delegate-expert.ts`
- Create: `src/server/agents/manager/tools/delegate-expert.test.ts`
- Create: `src/server/agents/manager/tools/report-actions.ts`
- Modify: `src/server/agents/workspace-tool-executor.ts`
- Modify: `tests/unit/server/agents/workspace-agent-runtime.test.ts`

**Interfaces:**
- `delegateExpert` accepts `expert: "argument" | "sources" | "perspectives" | "risks" | "synthesis"` and optional task text.
- `ManagerAgentRuntime.run(input)` creates a manager Pi session, subscribes to it and awaits `session.prompt()`.
- Report actions read and write only through existing authorization/version services.

- [ ] **Step 1: Write the failing delegation test**

```ts
it("delegates to a selected peer without exposing workspace identifiers", async () => {
  const result = await delegateExpert.execute("call", { expert: "risks", task: "review claims" });
  expect(runExpert).toHaveBeenCalledWith(expect.objectContaining({ expert: "risks", workspaceId }));
  expect(result.content[0]?.text).not.toContain(workspaceId);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/server/agents/manager/tools/delegate-expert.test.ts`

Expected: FAIL because manager has no peer tool.

- [ ] **Step 3: Implement manager tools and remove the AI SDK loop**

Remove `ToolLoopAgent`, `stepCountIs` and AI SDK `tool()` from manager. Build its session with `createPiSession`. The delegation tool maps a TypeBox enum to registered peer runners and returns only a redacted summary. Report action tools invoke the persistence service. Rename and thin `WorkspaceToolExecutor` into service methods: retain authorization, run state, artifact saves, version checks, cancellation and publish validation; remove model-facing fixed sequencing.

- [ ] **Step 4: Verify manager behavior**

Run: `pnpm vitest run tests/unit/server/agents/workspace-agent-runtime.test.ts src/server/agents/manager/tools/delegate-expert.test.ts`

Expected: PASS; manager can select eligible peers and service writes remain validated.

- [ ] **Step 5: Commit**

```bash
git add src/server/agents/manager src/server/agents/workspace-tool-executor.ts tests/unit/server/agents/workspace-agent-runtime.test.ts
git commit -m "feat: run manager coordination with Pi"
```

### Task 5: Bridge Pi events to AG-UI and remove obsolete runtime code

**Files:**
- Create: `src/server/agents/manager/pi-event-bridge.ts`
- Create: `src/server/agents/manager/pi-event-bridge.test.ts`
- Modify: `src/server/agents/manager/agent.ts`
- Modify: `scripts/evaluate-baseline.ts`
- Modify: `src/server/container.ts`
- Delete: unused AI SDK runtime files and tests after call-site search
- Create: `tests/e2e/manager-agent.spec.ts`

**Interfaces:**
- `bridgePiEvent(event, context): Promise<void>` maps Pi `agent_*`, `turn_*`, `message_update` and `tool_execution_*` events to existing `agent.ui.*` events.
- The bridge never publishes raw thinking, tool details, prompt text or credentials.

- [ ] **Step 1: Write the failing event test**

```ts
it("publishes a redacted AG-UI tool result", async () => {
  await bridgePiEvent(toolExecutionEnd({ toolName: "delegate_expert", details: { secret: "x" } }), context);
  expect(appendEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "agent.ui.tool.result" }));
  expect(serializedEvents()).not.toContain("secret");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/server/agents/manager/pi-event-bridge.test.ts`

Expected: FAIL because the bridge is missing.

- [ ] **Step 3: Implement the bridge and update evaluation**

Subscribe once per session. Map trusted text deltas, tool starts/ends, agent completion, cancellation and errors to existing event payloads. Update evaluation to use peer Pi harnesses. Delete an AI SDK adapter only when `rg` proves it has no callers.

- [ ] **Step 4: Write and run the key user-path test**

```ts
test("manager delegates an expert and publishes a validated report", async ({ page }) => {
  await page.goto("/analysis/new");
  await page.getByLabel("分析材料").fill("政策会改善就业");
  await page.getByRole("button", { name: "开始分析" }).click();
  await expect(page.getByText("客户经理")).toBeVisible();
  await expect(page.getByText("报告已发布")).toBeVisible();
});
```

Run: `pnpm validate && pnpm test:unit && pnpm test:integration && pnpm playwright test tests/e2e/manager-agent.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src scripts tests package.json pnpm-lock.yaml
git commit -m "refactor: replace AI SDK agent loop with Pi"
```
