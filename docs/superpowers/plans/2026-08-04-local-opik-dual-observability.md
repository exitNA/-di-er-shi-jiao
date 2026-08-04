# Local Opik Dual Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变 Agent 业务调用点的前提下，让本地 Langfuse 与 Opik 都以各自 TypeScript SDK 原生语义记录同一次分析运行。

**Architecture:** 将 `langfuse.ts` 重命名为中立观测模块，由一个 active OpenTelemetry span 承载 Langfuse 上下文，并在同一生命周期创建/结束 Opik trace 和 span。Pi generation 复用该中立接口，避免它成为只写 Langfuse 的旁路。Opik 保持独立 Compose 项目。

**Tech Stack:** Next.js 16、TypeScript 6、Vitest 4、Langfuse 5、Opik TypeScript SDK 2.2.17、Docker Compose。

## Global Constraints

- 仅使用 pnpm 管理依赖；不得使用 npm 或 yarn。
- 完整 prompt、模型 I/O 和工具结果只发送给两套本地观测平台，不能写入结构化日志、HTTP 响应或 SSE。
- 不编写或运行 E2E 测试；关键路径由人工验证。
- 不引入 OTel Collector、Langfuse Cloud、Opik Cloud 或旧 API 的兼容别名。

---

### Task 1: 建立 Opik 本地栈与运行配置

**Files:**
- Create: `scripts/opik-up.sh`
- Create: `scripts/opik-down.sh`
- Create: `compose.opik.yaml`
- Create: `tests/unit/scripts/opik.test.ts`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `src/server/config/env.ts`

**Interfaces:**
- Produces: `pnpm opik:up`、`pnpm opik:down`；`OPIK_URL_OVERRIDE=http://localhost:5173/api` 与 `OPIK_PROJECT_NAME=second-perspective`。
- Consumes: Opik 官方本地 Docker Compose 拓扑，UI 为 `http://localhost:5173`。

- [ ] **Step 1: Write the failing test**

```ts
expect(JSON.parse(packageJson).scripts["opik:up"]).toContain("scripts/opik-up.sh");
expect(compose).toMatch(/^name: second-perspective-opik$/m);
expect(envExample).toContain("OPIK_URL_OVERRIDE=http://localhost:5173/api");
expect(envExample).toContain("OPIK_PROJECT_NAME=second-perspective");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/scripts/opik.test.ts`

Expected: FAIL，因为 Opik 脚本、Compose 和环境变量尚不存在。

- [ ] **Step 3: Write minimal implementation**

```sh
#!/bin/sh
set -eu
opik_dir=.opik
[ -d "$opik_dir/.git" ] || git clone --depth=1 https://github.com/comet-ml/opik.git "$opik_dir"
docker compose --env-file .env -f compose.opik.yaml up -d --wait --wait-timeout 180
```

将官方本地部署 Compose 的必要服务写入 `compose.opik.yaml`，项目名固定为 `second-perspective-opik`，仅将前端 `5173` 绑定到 `127.0.0.1`。down 脚本使用相同的 env 文件与 Compose 文件执行 `down`，不加 `--volumes`。新增 scripts、环境变量和 Zod 必填字段。

- [ ] **Step 4: Run tests to verify it passes**

Run: `pnpm vitest run tests/unit/scripts/opik.test.ts && docker compose --env-file .env -f compose.opik.yaml config`

Expected: PASS；Compose 可解析且 Opik UI 不对非本机网卡暴露。

- [ ] **Step 5: Commit**

```bash
git add package.json .env.example src/server/config/env.ts compose.opik.yaml scripts/opik-up.sh scripts/opik-down.sh tests/unit/scripts/opik.test.ts
git commit -m "feat: add local Opik stack"
```

### Task 2: 建立中立的原生双写观测接口

**Files:**
- Create: `src/server/observability/observations.ts`
- Create: `tests/unit/server/observability/observations.test.ts`
- Delete: `src/server/observability/langfuse.ts`
- Modify: `package.json`
- Modify: `src/server/observability/tracing.ts`
- Modify: `src/instrumentation.ts`
- Modify: `src/trigger/run-agent.ts`
- Modify: all current imports of `@/server/observability/langfuse`
- Modify: `tests/unit/server/observability/tracing.test.ts`

**Interfaces:**
- Produces: `withAnalysisTrace<T>(input, run)`、`withObservation<T>(input, run)` 与 `ObservationHandle.update(attributes)`。
- Consumes: `{ name, asType: "agent" | "chain" | "generation" | "tool" | "retriever", input, metadata? }`。
- Produces: Opik root `trace`；`general` span 对应 agent/chain/retriever，`tool` 对应 tool，`llm` 对应 generation；Langfuse 继续使用现有 observation 类型。

- [ ] **Step 1: Write the failing test**

```ts
await withAnalysisTrace(traceInput, () => withObservation(
  { name: "expert.argument", asType: "generation", input: { prompt: "完整提示词" } },
  async (observation) => observation.update({ output: "完整输出", model: "test-model" }),
));
expect(opikTrace.span).toHaveBeenCalledWith(expect.objectContaining({ type: "llm" }));
expect(opikSpan.update).toHaveBeenCalledWith(expect.objectContaining({ output: "完整输出" }));
expect(langfuseExporter.getFinishedSpans()).toHaveLength(2);
```

同时测试 `run` 抛出 `new Error("provider failed")` 时，Langfuse 更新 ERROR，Opik span 以 error 结束，原错误被重新抛出。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/server/observability/observations.test.ts`

Expected: FAIL，因为中立模块与 Opik SDK 尚不存在。

- [ ] **Step 3: Write minimal implementation**

```sh
pnpm add opik@2.2.17
```

`observations.ts` 从环境创建一个长生命周期 `Opik` client。`withAnalysisTrace` 在 root context 同时建立 Langfuse trace 属性和 Opik trace；以 OTel context 保存当前 Opik 父节点。 `withObservation` 同时创建 Langfuse observation 和 Opik span，由一个 handle 将 input、output、metadata、model、usageDetails、costDetails 与错误状态更新至两边；无显式 output 时写入 `run` 返回值。将 tracing 函数改名为 `startObservability`、`flushObservability`；flush 同时调用 Opik client 的 `flush()`。

- [ ] **Step 4: Replace callers and verify**

将所有 `withLangfuseObservation` import/call 替换为 `withObservation`；迁移 Langfuse 单测；更新 Trigger mock。

Run: `pnpm vitest run tests/unit/server/observability/observations.test.ts tests/unit/server/observability/tracing.test.ts tests/unit/server/adapters/tasks/trigger-analysis-dispatcher.test.ts`

Expected: PASS；两个 SDK mock 都收到同一输入、输出、metadata 与错误。

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/instrumentation.ts src/trigger/run-agent.ts src/server/observability src/server/agents tests/unit/server/observability tests/unit/server/adapters/tasks/trigger-analysis-dispatcher.test.ts
git commit -m "feat: dual-write Langfuse and Opik observations"
```

### Task 3: 将 Pi generation 纳入双写层并完成验收材料

**Files:**
- Modify: `src/server/agents/shared/pi-session.ts`
- Modify: `tests/unit/server/agents/pi-observability.test.ts`
- Modify: `tests/unit/server/agents/tool-observability.test.ts`
- Modify: `README.md`
- Modify: `docs/operations/mvp-baseline.md`

**Interfaces:**
- Consumes: 中立 generation 生命周期 handle。
- Produces: 每个 Pi turn 在 Langfuse 为 generation、在 Opik 为 `llm` span；工具调用仍以该 generation 为父节点。

- [ ] **Step 1: Write the failing test**

```ts
expect(opikTrace.span).toHaveBeenCalledWith(expect.objectContaining({
  name: "pi.generation",
  type: "llm",
  input: expect.objectContaining({ systemPrompt: expect.any(String) }),
}));
expect(opikGeneration.update).toHaveBeenCalledWith(expect.objectContaining({
  output: expect.objectContaining({ assistant: expect.anything() }),
  model: "observed-model",
}));
```

再断言取消与 provider error 同时结束两侧 generation。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/server/agents/pi-observability.test.ts tests/unit/server/agents/tool-observability.test.ts`

Expected: FAIL，因为 Pi 仍直接调用 Langfuse `startObservation`。

- [ ] **Step 3: Write minimal implementation**

将 Pi 的 `startObservation`、`LangfuseGeneration` 与私有 generation context 替换为中立 generation handle。 `turn_start` 创建 generation；`turn_end` 更新 assistant、工具结果、模型、usage 与 cost 后结束；`agent_end`、`session.prompt` catch 与取消复用同一错误结束函数。handle 暴露 Langfuse OTel span 作为工具的 active context，并保存 Opik 父节点。

- [ ] **Step 4: Update docs and verify**

README 与 MVP 基线增加 `pnpm opik:up/down`、本地地址及并排验收项：同一个 analysis 在两边显示 manager、专家、generation、搜索、报告动作、I/O、token、成本与错误。明确完整数据不进入 SSE 或结构化日志。

Run: `pnpm test:unit && pnpm typecheck && pnpm lint:build && pnpm lint:style && docker compose --env-file .env -f compose.opik.yaml config && docker compose --env-file .env -f compose.langfuse.yaml config`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/server/agents/shared/pi-session.ts tests/unit/server/agents/pi-observability.test.ts tests/unit/server/agents/tool-observability.test.ts README.md docs/operations/mvp-baseline.md
git commit -m "feat: trace Pi generations in Opik"
```

## Self-review

- Spec coverage: Task 1 covers local Opik stack/config; Task 2 covers native SDK dual-write, neutral API, errors and flush; Task 3 covers Pi generation, privacy documentation and validation.
- Placeholder scan: no incomplete work markers or unspecified validation steps.
- Type consistency: all business callers consume `withAnalysisTrace` and `withObservation`; only Pi consumes the explicit generation lifecycle handle.
