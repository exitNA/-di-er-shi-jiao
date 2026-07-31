# Server Startup Config Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在服务启动成功后输出安全且人类可读的配置摘要。

**Architecture:** `src/server.ts` 在 HTTP 服务监听回调中组装固定字段，并为每个字段输出一行键值文本。敏感配置只通过掩码或布尔值表达是否存在。

**Tech Stack:** Node.js、Next.js、TypeScript。

## Global Constraints

- 不输出完整连接串、用户名、密码、密钥、令牌或密码哈希。
- 不新增依赖。
- 保留现有的可读监听地址日志。

---

### Task 1: 输出安全启动配置摘要

**Files:**
- Modify: `src/server.ts`

**Interfaces:**
- Consumes: `process.env` 中的运行环境变量。
- Produces: 一组以 `Startup config:` 开头的分行文本日志。

- [x] **Step 1: 定义安全字段**

在启动回调中构造包含以下字段的对象：

```ts
{
  event: "server_started",
  hostname,
  port,
  nodeEnv: process.env.NODE_ENV ?? "development",
  cozeProjectEnv: process.env.COZE_PROJECT_ENV ?? "development",
  agentAdapter: process.env.AGENT_ADAPTER ?? "fake",
  analysisRuntime: process.env.ANALYSIS_RUNTIME ?? "in-process",
  database: {
    configured: true,
    valid: true,
    protocol: "postgres:",
    host: "db.example.com",
    port: "5432",
    name: "second_perspective",
    username: "***",
    password: "***",
    sslMode: "require",
  },
  authConfigured: Boolean(process.env.AUTH_SECRET),
  llmConfigured: Boolean(process.env.LLM_API_KEY),
  tavilyConfigured: Boolean(process.env.TAVILY_API_KEY),
  triggerConfigured: Boolean(process.env.TRIGGER_SECRET_KEY),
  telemetryConfigured: Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT),
}
```

- [x] **Step 2: 输出文本日志**

在现有监听地址日志之后调用：

```ts
console.info(`Startup config: database=${databaseSummary}`);
```

- [x] **Step 3: 验证启动日志与敏感值保护**

运行：

```bash
DATABASE_URL='postgres://user:super-secret@localhost/app' AUTH_SECRET='a-very-long-secret-value-for-verification' timeout 20s pnpm dev
```

预期：日志包含 `Startup config:` 与掩码数据库摘要，不包含 `super-secret`、用户名、密码或认证密钥内容。

- [x] **Step 4: 验证类型与格式**

运行：

```bash
pnpm typecheck
git diff --check -- src/server.ts
```

预期：命令成功。

- [x] **Step 5: 提交实现**

```bash
git add src/server.ts docs/superpowers/plans/2026-07-31-server-startup-config-log.md
git commit -m "feat: log safe startup configuration"
```
