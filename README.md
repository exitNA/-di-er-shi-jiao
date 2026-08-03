# 第二视角

第二视角把一段中文、英文或混合文本拆成可追溯的认知体检报告。
每次提交创建一个持久化工作空间；前台 Agent 在其中调用受控专家工具，并只展示安全摘要。
用户可以终止当前 Agent run，稍后从已保存的报告模块、专家摘要和对话继续分析。

## 本地快速开始

需要 Node.js、pnpm、Docker Compose 和 `openssl`。

```bash
pnpm install
cp .env.example .env.local
openssl rand -hex 32
pnpm db:init:dev
pnpm dev
```

把 `openssl` 输出写入 `.env.local` 的 `AUTH_SECRET`，然后访问
<http://localhost:5000/register>。运行需要真实模型和 `DATABASE_URL`：
配置 `LLM_BASE_URL`、`LLM_API_KEY` 和 `LLM_MODEL_ID`；
配置 `TAVILY_API_KEY` 后启用在线搜索。后台可使用 `in-process` 或 Trigger.dev。

## 集成测试

集成测试使用独立的 PostgreSQL 测试容器：

```bash
pnpm test:integration
pnpm test:db:down
```

这两个命令不读取 `.env` 或 `.env.local`。

完整的数据库、真实模型、Tavily、Trigger.dev、恢复、监控、评测、回滚和发布步骤见
[MVP 基线运维手册](docs/operations/mvp-baseline.md)。质量人工评审口径见
[基线报告评测规则](docs/evaluation/baseline-rubric.md)。
