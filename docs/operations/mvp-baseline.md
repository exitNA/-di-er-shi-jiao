# MVP 基线报告运维手册

本手册覆盖 M0 + M1 的本地启动、真实服务接入、后台任务、恢复、监控、评测、回滚和生产检查。命令均从仓库根目录运行。

## 1. 前置条件与安装

需要 Node.js、pnpm、Docker Compose、`openssl`，以及包含 `psql`、`pg_dump`、`pg_restore` 的 PostgreSQL 客户端。

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
openssl rand -hex 32
```

把最后一条命令的输出写入 `.env.local` 的 `AUTH_SECRET`。不要提交 `.env.local`。

## 2. 数据库、迁移、测试清理与备份

启动本地 PostgreSQL 并执行迁移：

```bash
pnpm db:up
DATABASE_URL=postgres://app:app@127.0.0.1:54329/second_perspective pnpm db:migrate
```

本地应用库为 `second_perspective`，隔离测试库为 `second_perspective_test`。集成测试和 E2E 夹具会自动迁移并清理测试库。需要手动清理时，使用仓库内置的安全检查；数据库名不以 `_test` 结尾时命令会拒绝执行：

```bash
TEST_DATABASE_URL=postgres://app:app@127.0.0.1:54329/second_perspective_test pnpm exec tsx -e 'import("./tests/helpers/database.ts").then(({ truncateTestDb }) => truncateTestDb())'
```

迁移或发布前备份，文件权限保持仅当前用户可读：

```bash
export DATABASE_URL=postgres://app:app@127.0.0.1:54329/second_perspective
install -d -m 700 backups
pg_dump --format=custom --no-owner --file "backups/second-perspective-$(date -u +%Y%m%dT%H%M%SZ).dump" "$DATABASE_URL"
```

先恢复到临时数据库验证备份，不直接覆盖生产库：

```bash
createdb second_perspective_restore_check
pg_restore --exit-on-error --no-owner --dbname second_perspective_restore_check backups/<backup-file>.dump
dropdb second_perspective_restore_check
```

## 3. 无外部依赖的本地 fake 模式

`.env.local` 至少包含：

```dotenv
APP_URL=http://127.0.0.1:3000
DATABASE_URL=postgres://app:app@127.0.0.1:54329/second_perspective
TEST_DATABASE_URL=postgres://app:app@127.0.0.1:54329/second_perspective_test
AUTH_SECRET=<openssl-rand-hex-32-output>
AGENT_ADAPTER=fake
ANALYSIS_RUNTIME=in-process
```

启动：

```bash
pnpm dev
```

访问 <http://127.0.0.1:3000/register>。fake 模式是确定性的，不调用 LLM 或搜索服务；前缀
`[测试：任务中断]` 和 `[测试：信源失败一次]` 仅在非生产环境启用。

## 4. 真实 LLM 与 Tavily

真实适配器使用 OpenAI 兼容协议，联网搜索始终独立走 Tavily。把以下变量写入运行环境：

```dotenv
AGENT_ADAPTER=openai-compatible
LLM_BASE_URL=https://<provider-host>/v1
LLM_API_KEY=<secret>
LLM_MODEL_ID=<model-id>
TAVILY_API_KEY=<secret>
LLM_INPUT_USD_PER_MILLION=<non-negative-number>
LLM_OUTPUT_USD_PER_MILLION=<non-negative-number>
```

CLI 脚本不依赖 Next.js 加载 `.env.local`；在本地先把已填写的文件导出到当前终端：

```bash
set -a
. ./.env.local
set +a
```

先验证模型具备工具调用、结构化输出、流式响应和简体中文输出能力：

```bash
pnpm probe:llm
```

命令退出码必须为 `0`，输出中的 `structuredOutput`、`toolCall`、`streamedText` 必须都为 `true`。探测失败时不要切换生产流量。

## 5. Trigger.dev Cloud

1. 在 Trigger.dev Cloud 创建项目，记录 project ref，并为 Web 应用生成 secret key。
2. 给 Web 应用和 Trigger.dev 任务配置同一组 `DATABASE_URL`、LLM、Tavily 和价格变量。
3. Web 应用配置：

```dotenv
ANALYSIS_RUNTIME=trigger
TRIGGER_PROJECT_REF=<project-ref>
TRIGGER_SECRET_KEY=<secret>
```

本地联调时，先启动 Trigger.dev 开发 worker：

```bash
pnpm exec trigger.dev dev
```

在另一个终端启动 Web 应用：

```bash
pnpm dev
```

部署任务定义：

```bash
pnpm exec trigger.dev deploy
```

任务 ID 固定为 `run-baseline-analysis`。部署后确认 Trigger.dev 控制台能看到该任务，再发布使用
`ANALYSIS_RUNTIME=trigger` 的 Web 应用。

## 6. 状态与稳定错误码

任务状态：

| 状态 | 含义 | 操作 |
| --- | --- | --- |
| `queued` | 已持久化，等待后台执行 | 检查派发器和 Trigger.dev |
| `running` | 专家或综合流程正在执行 | 等待 SSE；断线时客户端自动轮询 |
| `partial` | 信源失败，其余报告可用 | 重试失败的信源模块 |
| `completed` | 六个模块均可用 | 无 |
| `recoverable` | 非信源专家、编排或派发失败 | 按恢复流程继续 |

模块状态为 `queued`、`running`、`completed` 或 `failed`。失败模块保留已完成模块及其版本。

可直接用于告警与操作判断的稳定错误码：

| 类别 | 错误码 |
| --- | --- |
| 输入 | `EMPTY`、`TOO_LONG`、`UNSAFE_CONTENT` |
| 派发与编排 | `DISPATCH_FAILED`、`TASK_INTERRUPTED`、`ORCHESTRATION_FAILED`、`REQUIRED_MODULE_UNAVAILABLE` |
| 专家 | `EXPERT_FAILED`、`EXPERT_TIMEOUT`、`INVALID_EXPERT_OUTPUT` |
| LLM | `LLM_AUTHENTICATION_FAILED`、`LLM_RATE_LIMITED`、`LLM_TIMEOUT`、`LLM_SCHEMA_INVALID`、`LLM_UNKNOWN_ERROR` |
| 搜索 | `SEARCH_AUTHENTICATION_FAILED`、`SEARCH_RATE_LIMITED`、`SEARCH_QUERY_TOO_LONG`、`SEARCH_UNAVAILABLE`、`SEARCH_UNKNOWN_ERROR` |

表中的英文错误码用于任务状态、事件和安全日志诊断；它们不是当前 HTTP API 的响应字段。读取快照或事件时，未登录返回 `401` 和“请先登录”，资源不属于当前用户或不存在时统一返回 `404` 和“分析不存在”。重试路由成功返回 `202`；模块不支持重试返回 `400`，当前状态不能重试返回 `409`，派发失败返回 `503`，响应正文均为中文 `error`。跨用户读取和重试统一表现为 `404`，不要向调用方泄露资源是否存在。

## 7. 重试与恢复

### 信源降级

1. 确认任务为 `partial`，且只有 `sources` 为 `failed`。
2. 先检查 Tavily 凭据、配额和连通性。
3. 用户在报告页选择“重试信源对照”；接口只重跑该模块。
4. 确认任务转为 `completed`，原有内容模块仍可用。

### 可恢复任务

1. 用 `jobId` 查 Trigger.dev 运行和安全日志，只读取错误码、尝试次数和耗时。
2. 修复凭据、配额或 worker 故障。
3. 报告页若显示失败模块，使用对应“重试”按钮；它会以
   `${jobId}:${moduleType}:${nextVersion}` 作为派发幂等键。
4. `DISPATCH_FAILED` 等没有失败模块可点选时，在受控运维终端恢复整个任务：

```bash
JOB_ID=<uuid> pnpm exec tsx -e 'import("./src/server/container.ts").then(async ({ getContainer }) => { const jobId = process.env.JOB_ID; if (!jobId) throw new Error("JOB_ID is required"); console.log(await getContainer().baselineOrchestrator.run({ jobId })); })'
```

只对状态为 `recoverable` 的任务执行；`completed` 任务会拒绝重新获得执行权。恢复前后分别读取
`GET /api/analyses/<jobId>`，确认已完成模块的版本和内容没有回退。

## 8. 安全日志与 OpenTelemetry

结构化日志只允许记录 `jobId`、`operation`、`errorCode`、`durationMs`、`attempt` 等运行元数据。不得记录完整原文、用户名、密码、会话令牌、prompt、模型 response、API key 或任意未经筛选的异常对象。

启用 OTLP/HTTP trace 导出：

```dotenv
OTEL_EXPORTER_OTLP_ENDPOINT=http://<otel-collector>:4318/v1/traces
```

重启 Web 应用和 Trigger.dev 任务后，确认服务名为 `second-perspective`，并能看到
`analysis.job`、`analysis.expert`、`analysis.synthesis`、`analysis.review`、
`search.request`、`llm.generate` spans。Span 属性同样不得附带原文或模型输入输出。

告警至少覆盖：任务 `recoverable`、信源降级率、专家成功率、首模块 P95、完整报告 P95 和估算 token 成本。

## 9. 30 样本评测与双评审

真实服务环境先运行：

```bash
pnpm eval:run
```

产物位于 `tmp/evaluations/baseline-v1/<timestamp>/`。评审人 A、B 独立填写
`reviewer-a.csv` 和 `reviewer-b.csv`，提交前不得查看对方结果。评分：

```bash
pnpm eval:score
```

若输出分歧样本，由第三位评审只裁决分歧项：

```bash
pnpm eval:score <run-directory> --adjudication path/to/adjudication.csv
```

全部门槛必须同时通过：

| 指标 | 门槛 |
| --- | --- |
| 六模块结构完整率 | `>= 90%` |
| 引用 URL 有效率 | `>= 95%` |
| 引用支持率 | `>= 85%` |
| 高置信风险精确率 | `>= 80%` |
| 中立性通过率 | `>= 85%` |
| 报告成功率（含明确的信源降级） | `>= 90%` |
| 首模块 P95 | `<= 10s` |
| 完整基线 P95 | `<= 60s` |

逐列定义和填写示例见 [基线报告评测规则](../evaluation/baseline-rubric.md)。

## 10. 配置版本回滚

每个任务会持久化 `configVersion`；当前提交入口固定写入 `baseline-v1`。不要直接更新数据库中的版本字段。回滚以已验证的 Git release ref 为单位，同时回滚 Web 与 Trigger.dev 任务：

```bash
KNOWN_GOOD_REF=<release-tag-or-commit>
git worktree add ../second-perspective-rollback "$KNOWN_GOOD_REF"
cd ../second-perspective-rollback
pnpm install --frozen-lockfile
pnpm build
pnpm exec trigger.dev deploy
```

用相同 ref 重新部署 Web 应用，保留回滚前数据库备份。完成生产 smoke checks 后再恢复流量。旧任务的
`configVersion` 是审计证据，不因回滚而改写；需要恢复的旧任务使用其已持久化版本定位对应发布。

## 11. 生产 smoke checks

发布前确认迁移、Web 和任务部署来自同一 release ref，并已备份数据库。随后执行：

```bash
export APP_URL=https://<production-host>
curl --fail --silent --show-error "$APP_URL/login" >/dev/null
pnpm probe:llm
```

使用专用 smoke 账号在浏览器完成：

1. 注册或登录，提交一段不含敏感信息的短文本。
2. 看到论证模块先出现，刷新后内容仍在，最终六模块完成。
3. 打开一个外部信源，确认标题、发布者、日期和链接可用。
4. 从历史记录重新打开报告，再退出登录。
5. 确认 Trigger.dev 只有一次基线派发，OTel 有对应 job/expert spans，日志没有原文或身份凭据。

真实服务 gate 还必须完成 `pnpm eval:run` 和双评审后的 `pnpm eval:score`。

## 12. 密钥轮换

1. 在 LLM、Tavily 或 Trigger.dev 供应商创建新密钥，旧密钥暂不撤销。
2. 同时更新 Web 和 Trigger.dev Cloud 环境变量并重新部署。
3. 运行 `pnpm probe:llm` 和生产 smoke checks。
4. 确认新任务成功后撤销旧密钥。

`AUTH_SECRET` 当前用于认证限流键的 HMAC；轮换会切换限流键空间，但不会主动撤销数据库中的会话。若事件要求所有用户重新登录，在部署新 secret 后显式撤销活动会话：

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL;"
```

密钥只进入受控 secret store，不写入仓库、日志、Trace、评测产物或工单正文。
