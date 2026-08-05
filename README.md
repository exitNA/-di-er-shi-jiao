# 第二视角

第二视角把一段中文、英文或混合文本拆成可追溯的认知体检报告。
每次提交创建一个持久化工作空间；前台 Agent 在其中调用受控专家工具，并只展示安全摘要。
用户可以终止当前 Agent run，稍后从已保存的报告模块、专家摘要和对话继续分析。

## 本地快速开始

需要 Node.js、pnpm、Docker Compose 和 `openssl`。

```bash
pnpm install
cp .env.example .env
openssl rand -hex 32
pnpm db:init:dev
pnpm langfuse:up
pnpm dev
```

把 `openssl` 输出写入 `.env` 的 `AUTH_SECRET`，然后访问
<http://localhost:5000/register>。运行需要真实模型和 `DATABASE_URL`：
配置 `LLM_BASE_URL`、`LLM_API_KEY` 和 `LLM_MODEL_ID`；支持推理的模型可选配
`LLM_REASONING_EFFORT`（`low`、`high` 或 `max`）。
可通过 `LLM_REASONING_EFFORT_MANAGER`、`_ARGUMENT`、`_PERSPECTIVES`、`_SOURCES`、`_RISKS`、`_SYNTHESIS`
为各 Agent 覆盖默认值。
配置 `TAVILY_API_KEY` 后启用在线搜索。后台可使用 `in-process` 或 Trigger.dev。

## 本地 Langfuse

`pnpm langfuse:up` 启动独立的本地 Langfuse 栈，并在未跟踪的
`.env` 生成项目连接信息和服务密钥。访问 <http://localhost:3000>，管理员密码可在
`.env` 的 `LANGFUSE_INIT_USER_PASSWORD` 中查看。停止服务使用
`pnpm langfuse:down`；该命令保留观察数据卷。

一次分析会写入 Langfuse，展示同一个 analysis 下的 manager、专家、generation、搜索与报告动作，以及完整 I/O、token、成本、错误和取消状态。
这些完整数据只进入观测平台，不进入浏览器 SSE 或结构化日志。

## 集成测试

集成测试使用独立的 PostgreSQL 测试容器：

```bash
pnpm test:integration
pnpm test:db:down
```

这两个命令不读取 `.env`。

完整的数据库、真实模型、Tavily、Trigger.dev、恢复、监控、回滚和发布步骤见
[MVP 基线运维手册](docs/operations/mvp-baseline.md)。
