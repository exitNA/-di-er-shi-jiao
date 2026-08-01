# 第二视角

第二视角把一段中文、英文或混合文本拆成可追溯的认知体检报告。

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
<http://localhost:5000/register>。默认 `AGENT_ADAPTER=fake`、
`ANALYSIS_RUNTIME=in-process`，不需要外部服务密钥。

完整的数据库、真实模型、Tavily、Trigger.dev、恢复、监控、评测、回滚和发布步骤见
[MVP 基线运维手册](docs/operations/mvp-baseline.md)。质量人工评审口径见
[基线报告评测规则](docs/evaluation/baseline-rubric.md)。
