# 本地 Langfuse 全链路观察 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在本地 Docker Compose 中运行 Langfuse，并以原生 Langfuse OTel 观察覆盖每次分析的 manager、专家、Pi 模型、工具和报告发布全过程。

**Architecture:** `compose.langfuse.yaml` 承载独立的 Langfuse 官方服务拓扑及持久化数据。Next.js Node instrumentation 用 `LangfuseSpanProcessor` 取代通用 OTLP exporter；一个小的 server-only observability 模块以 Langfuse v5 observation API 建立父子上下文，Pi 事件及现有执行器在该上下文下补充完整 I/O。

**Tech Stack:** Docker Compose、Langfuse self-hosted、`@langfuse/tracing`、`@langfuse/otel`、OpenTelemetry Node SDK、Pi agent。

## Global Constraints

- 仅本地 Docker Compose；不支持 Langfuse Cloud、远程部署或双写 OTLP。
- 使用 `pnpm`，不使用 npm/yarn。
- 记录用户标识、原始材料、提示词、模型输入输出、工具参数/结果/来源 URL、token、成本和错误；SSE 的脱敏边界不改变。
- 仅保留 `LANGFUSE_BASE_URL`、`LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY`、`LANGFUSE_TRACING_ENVIRONMENT`；删除 `OTEL_EXPORTER_OTLP_ENDPOINT` 及旧 OTLP exporter。
- 失败或缺失 Langfuse 配置必须显式失败，不能静默丢失 trace。
- 不编写或运行 E2E 测试；关键用户路径由用户手工测试。

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `compose.langfuse.yaml` | Langfuse Web/Worker/存储依赖的本地独立 Compose 栈。 |
| `scripts/langfuse-up.sh` | 生成未跟踪的本地密钥、预置项目连接参数、启动并等待服务。 |
| `scripts/langfuse-down.sh` | 安全停止栈并保留 volumes。 |
| `src/server/observability/langfuse.ts` | 以 Langfuse observation API 建立 analysis、agent、generation 和 tool 的父子上下文。 |
| `src/server/observability/tracing.ts` | 以 LangfuseSpanProcessor 初始化 NodeSDK，删除旧 OTLP exporter。 |
| `src/server/agents/shared/pi-session.ts` | 采集 Pi turn 和模型 generation 的详细输入输出、token/成本与错误。 |
| `src/server/agents/manager/agent.ts` | 为分析建立 trace，管理 manager observation 生命周期。 |
| `src/server/agents/workspace-tool-executor.ts` | 为专家委派、搜索和报告动作创建 tool observations。 |

### Task 1: 本地 Langfuse 栈与开发命令

**Files:**
- Create: `compose.langfuse.yaml`
- Create: `scripts/langfuse-up.sh`
- Create: `scripts/langfuse-down.sh`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `README.md`
- Test: `tests/unit/scripts/langfuse.test.ts`

**Produces:** `pnpm langfuse:up` 创建并启动独立本地 Langfuse 栈；`.env` 包含应用使用的 `LANGFUSE_*` 连接值。

- [ ] **Step 1: 写失败的 Compose/脚本契约测试**

```ts
it("starts Langfuse with generated local credentials and persistent services", () => {
  expect(read("package.json").scripts["langfuse:up"]).toContain("scripts/langfuse-up.sh");
  expect(read("compose.langfuse.yaml").services).toMatchObject({
    "langfuse-web": expect.any(Object),
    "langfuse-worker": expect.any(Object),
    clickhouse: expect.any(Object),
    redis: expect.any(Object),
    minio: expect.any(Object),
  });
  expect(read(".env.example")).toContain("LANGFUSE_BASE_URL=http://localhost:3000");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/unit/scripts/langfuse.test.ts`

Expected: FAIL，因为 Compose、脚本和命令尚不存在。

- [ ] **Step 3: 编写最小部署与初始化实现**

以 Langfuse 官方 Compose 拓扑创建 `compose.langfuse.yaml`：web、worker、PostgreSQL、ClickHouse、Redis、MinIO 均使用具名卷；只发布 web 的 `3000` 端口，其余服务不发布宿主机端口。`langfuse-up.sh` 必须：

```sh
set -eu
umask 077
test -f .env || {
  printf 'LANGFUSE_BASE_URL=http://localhost:3000\n' > .env
  printf 'LANGFUSE_PUBLIC_KEY=pk-lf-local-%s\n' "$(openssl rand -hex 16)" >> .env
  printf 'LANGFUSE_SECRET_KEY=sk-lf-local-%s\n' "$(openssl rand -hex 32)" >> .env
}
docker compose --env-file .env -f compose.langfuse.yaml up -d --wait
```

Compose 使用这些 key 预置本地项目；其余 Langfuse 服务密钥由同一脚本生成并写入该未跟踪文件。`langfuse-down.sh` 仅执行 `docker compose ... down`，不得加入 `--volumes`。加入 `langfuse:up`、`langfuse:down` 命令、`.env.example` 注释与 README 使用说明。

- [ ] **Step 4: 运行部署契约与 Compose 校验**

Run: `pnpm vitest run tests/unit/scripts/langfuse.test.ts && docker compose --env-file .env -f compose.langfuse.yaml config --quiet`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add compose.langfuse.yaml scripts/langfuse-up.sh scripts/langfuse-down.sh package.json .env.example README.md tests/unit/scripts/langfuse.test.ts
git commit -m "feat: add local Langfuse stack"
```

### Task 2: 用 Langfuse 原生 tracing 替换旧 OTLP

**Files:**
- Create: `src/server/observability/langfuse.ts`
- Create: `tests/unit/server/observability/langfuse.test.ts`
- Modify: `src/server/observability/tracing.ts`
- Modify: `src/server/config/env.ts`
- Modify: `tests/unit/server/config/env.test.ts`
- Modify: `src/instrumentation.ts`
- Modify: `src/server.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Delete: 旧 OTLP exporter 专用测试与引用（由 `rg` 确认后）

**Consumes:** Task 1 写入的 `LANGFUSE_*` 环境变量。

**Produces:**

```ts
export async function withLangfuseObservation<T>(input: {
  name: string;
  asType: "agent" | "chain" | "generation" | "tool" | "retriever";
  input: unknown;
  metadata?: Record<string, string>;
}, run: (observation: { update(input: Record<string, unknown>): void }) => Promise<T>): Promise<T>;

export async function withAnalysisTrace<T>(input: {
  workspaceId: string;
  userId: string;
  kind: "baseline" | "challenge";
  material: string;
}, run: () => Promise<T>): Promise<T>;
```

- [ ] **Step 1: 写失败的 Langfuse 上下文与环境测试**

```ts
it("propagates a detailed analysis trace to a nested generation", async () => {
  await withAnalysisTrace({ workspaceId: "w1", userId: "u1", kind: "baseline", material: "原始材料" }, async () => {
    await withLangfuseObservation({ name: "expert.argument", asType: "generation", input: { prompt: "完整提示词" } }, async (observation) => {
      observation.update({ output: "完整输出", model: "test-model", usageDetails: { input: 2, output: 1 } });
    });
  });
  expect(recorded()).toContainEqual(expect.objectContaining({ input: { material: "原始材料" } }));
});

it("rejects missing LANGFUSE_SECRET_KEY instead of silently disabling tracing", () => {
  expect(() => parseEnvironment(validWithout("LANGFUSE_SECRET_KEY"))).toThrow(/LANGFUSE_SECRET_KEY/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/unit/server/observability/langfuse.test.ts tests/unit/server/config/env.test.ts`

Expected: FAIL，因为 Langfuse 模块和必填环境变量不存在。

- [ ] **Step 3: 实现原生 Langfuse 接入并删除旧出口**

执行：

```bash
pnpm add @langfuse/tracing @langfuse/otel
pnpm remove @opentelemetry/exporter-trace-otlp-http
```

在 `tracing.ts` 使用 `new LangfuseSpanProcessor()` 构造唯一的 `NodeSDK`；不再读取或导出 `OTEL_EXPORTER_OTLP_ENDPOINT`。`langfuse.ts` 用 `propagateAttributes()` 建立 `traceName`、`userId`、`sessionId`、string metadata，并用 `startActiveObservation()` 创建 observation。成功时用 `update({ output })` 写出结果；异常时写入错误信息并重新抛出。环境 schema 设 `LANGFUSE_BASE_URL` URL、public/secret key 非空、environment 固定默认 `local`。启动日志只报告 Langfuse 已启用，绝不输出 key。

- [ ] **Step 4: 运行单元和调用方搜索**

Run: `pnpm vitest run tests/unit/server/observability/langfuse.test.ts tests/unit/server/config/env.test.ts && rg -n "OTEL_EXPORTER_OTLP_ENDPOINT|OTLPTraceExporter|exporter-trace-otlp-http" src tests scripts package.json docs README.md`

Expected: 测试 PASS；`rg` 没有旧通用 OTLP 路径。

- [ ] **Step 5: 提交**

```bash
git add src/server/observability src/server/config/env.ts src/instrumentation.ts src/server.ts package.json pnpm-lock.yaml tests/unit/server/observability tests/unit/server/config/env.test.ts
git commit -m "feat: trace with Langfuse natively"
```

### Task 3: 为 manager 与 Pi 模型建立详细 observation 树

**Files:**
- Modify: `src/server/agents/manager/agent.ts`
- Modify: `src/server/agents/shared/pi-session.ts`
- Modify: `src/server/agents/shared/expert-harness.ts`
- Create: `tests/unit/server/agents/pi-observability.test.ts`
- Modify: `tests/unit/server/agents/workspace-agent-runtime.test.ts`

**Consumes:** Task 2 的 `withAnalysisTrace` 和 `withLangfuseObservation`。

**Produces:** manager 为 analysis root；每个专家为 agent/generation 子观察；每次 Pi prompt/turn 记录完整实际 system prompt、请求文本、输出、模型、token/成本、取消或错误。

- [ ] **Step 1: 写失败的 manager/Pi observation 测试**

```ts
it("records manager, expert and model generation as one detailed trace", async () => {
  await runtime.run({ workspaceId: "w1", agentRunId: "r1", signal: new AbortController().signal });
  expect(observations()).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: "manager", asType: "agent" }),
    expect.objectContaining({ name: "pi.generation", asType: "generation", input: expect.objectContaining({ systemPrompt: expect.any(String) }) }),
  ]));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/unit/server/agents/pi-observability.test.ts tests/unit/server/agents/workspace-agent-runtime.test.ts`

Expected: FAIL，因为 manager 与 Pi 没有 Langfuse observations。

- [ ] **Step 3: 接入父子上下文**

在 `ManagerAgentRuntime.run` 获得已授权 snapshot 后，以原始 material、userId、workspaceId、kind 包装整个运行；manager observation 写运行结果或错误。`createPiSession`/expert harness 在同一活动上下文中将每次 `prompt()` 和 Pi event 归类为 generation：输入包含 resolved system prompt 与消息，输出包含 assistant 文本和完成工具结果，metadata 包含 agent id/model id，usageDetails 写 Pi 返回的 usage（可得时），取消和 provider error 显式更新 status。不得改变 session 的资源隔离、工具白名单或 SSE 脱敏。

- [ ] **Step 4: 运行回归测试**

Run: `pnpm vitest run tests/unit/server/agents/pi-observability.test.ts tests/unit/server/agents/workspace-agent-runtime.test.ts src/server/agents/shared/pi-session.test.ts src/server/agents/shared/expert-harness.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/server/agents/manager/agent.ts src/server/agents/shared/pi-session.ts src/server/agents/shared/expert-harness.ts tests/unit/server/agents/pi-observability.test.ts tests/unit/server/agents/workspace-agent-runtime.test.ts
git commit -m "feat: observe Pi agent runs in Langfuse"
```

### Task 4: 为工具与持久化动作补全详细观察

**Files:**
- Modify: `src/server/agents/workspace-tool-executor.ts`
- Modify: `src/server/agents/sources/tools/search.ts`
- Create: `tests/unit/server/agents/tool-observability.test.ts`
- Modify: `docs/operations/mvp-baseline.md`

**Consumes:** Task 2 observation API；Task 3 活动 analysis trace。

**Produces:** 专家委派、搜索、审校/修订/发布均为嵌套 tool/retriever observations，保存完整输入、输出、来源 URL、成本和异常。

- [ ] **Step 1: 写失败的工具观察测试**

```ts
it("records complete search input, source URLs and results under the active trace", async () => {
  await executeSearch({ material: "待分析材料" });
  expect(observations()).toContainEqual(expect.objectContaining({
    name: "sources.search",
    asType: "retriever",
    input: expect.objectContaining({ material: "待分析材料" }),
    output: expect.objectContaining({ candidates: expect.arrayContaining([expect.objectContaining({ url: "https://example.com" })]) }),
  }));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/unit/server/agents/tool-observability.test.ts`

Expected: FAIL，因为工具调用未写 Langfuse observation。

- [ ] **Step 3: 实现工具观察**

把 `runExpert`、`runReportAction` 和 source search 的真实执行体包装为 observation。专家委派、审校、修订、发布使用 `asType: "tool"`；搜索使用 `asType: "retriever"`。在开始时写入完整 typed input，完成后写入实际 artifact/result，异常后写入 error 并重新抛出。复用既有执行器作为授权、版本、取消与持久化的唯一实现，不增加第二条执行路径。

- [ ] **Step 4: 运行聚焦和完整服务端验证**

Run: `pnpm vitest run tests/unit/server/agents/tool-observability.test.ts tests/unit/server/agents/workspace-agent-runtime.test.ts tests/integration/server/agents && pnpm typecheck`

Expected: PASS。

- [ ] **Step 5: 更新运维文档并提交**

更新 `docs/operations/mvp-baseline.md`，将 OTLP 配置替换为本地 Langfuse 启动、`.env`、详细数据范围和 UI 验收步骤。

```bash
git add src/server/agents/workspace-tool-executor.ts src/server/agents/sources/tools/search.ts tests/unit/server/agents/tool-observability.test.ts docs/operations/mvp-baseline.md
git commit -m "feat: observe agent tools with Langfuse"
```

### Task 5: 集成验证与旧监测移除审计

**Files:**
- Modify: `README.md`（只在最终命令或验收说明缺失时）
- Modify: 测试文件（仅修复 Task 1-4 所发现的当前契约失败）

**Consumes:** Task 1-4。

**Produces:** 当前树只包含 Langfuse 原生观测路径，且本地部署与服务端回归可复现。

- [ ] **Step 1: 写部署验收检查**

```ts
it("does not retain a legacy OTLP observability configuration", () => {
  expect(projectText()).not.toContain("OTEL_EXPORTER_OTLP_ENDPOINT");
  expect(projectText()).not.toContain("OTLPTraceExporter");
});
```

- [ ] **Step 2: 运行检查确认旧引用（若存在）**

Run: `pnpm vitest run tests/unit/server/observability/langfuse.test.ts && rg -n "OTEL_EXPORTER_OTLP_ENDPOINT|OTLPTraceExporter|exporter-trace-otlp-http" --glob '!docs/superpowers/**' .`

Expected: 测试 PASS，搜索无输出。

- [ ] **Step 3: 执行本地部署与服务端验证**

Run: `pnpm langfuse:up && pnpm test:unit && pnpm test:integration && pnpm typecheck && docker compose --env-file .env -f compose.langfuse.yaml ps`

Expected: Langfuse 服务健康，单元/集成/类型检查 PASS。

- [ ] **Step 4: 手工用户路径验收**

执行一次 baseline 分析，在 `http://localhost:3000` 查看同一 trace 下的 manager、五类专家、generation、search/report observations；检查详细 I/O、来源 URL、token/成本和失败状态均可见，浏览器 SSE 不出现原始 trace 内容或密钥。

- [ ] **Step 5: 提交**

```bash
git add README.md tests/unit/server/observability/langfuse.test.ts
git commit -m "test: verify local Langfuse observability"
```

## 自审

- 规格中的本地部署、唯一 Langfuse 出口、详细数据采集、Pi/工具全链路、旧 OTLP 删除、自动验证与手工 UI 验收分别由 Task 1-5 覆盖。
- 全文无 TBD/TODO/“稍后实现”占位符；跨任务导出的 observation 接口在 Task 2 定义，后续任务按同名接口消费。
- E2E 被项目当前规范禁止，因此计划仅使用单元、集成、Compose 校验与手工 Langfuse UI 验收。
