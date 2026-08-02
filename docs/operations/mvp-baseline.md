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

启动本地开发 PostgreSQL，并使用 `.env.local` 的 `DATABASE_URL` 执行迁移：

```bash
set -a
. ./.env.local
set +a
pnpm db:init:dev
```

集成测试使用独立的 PostgreSQL 测试容器，由测试命令注入固定的 `_test` 数据库 URL：

```bash
pnpm test:integration
pnpm test:db:down
```

这两个命令不读取 `.env` 或 `.env.local`。

迁移或发布前使用当前环境的 `DATABASE_URL` 备份，文件权限保持仅当前用户可读：

```bash
install -d -m 700 backups
pg_dump --format=custom --no-owner --file "backups/second-perspective-$(date -u +%Y%m%dT%H%M%SZ).dump" "$DATABASE_URL"
```

先恢复到临时数据库验证备份，不直接覆盖生产库：

```bash
createdb second_perspective_restore_check
pg_restore --exit-on-error --no-owner --dbname second_perspective_restore_check backups/<backup-file>.dump
dropdb second_perspective_restore_check
```

## 3. 本地真实 Agent 运行

`.env.local` 至少包含：

```dotenv
APP_URL=http://localhost:5000
DATABASE_URL=postgres://app:app@127.0.0.1:54329/second_perspective
AUTH_SECRET=<openssl-rand-hex-32-output>
AGENT_ADAPTER=openai-compatible
ANALYSIS_RUNTIME=in-process
LLM_BASE_URL=https://<provider-host>/v1
LLM_API_KEY=<secret>
LLM_MODEL_ID=<model-id>
# 可选：启用外部在线搜索。
TAVILY_API_KEY=<secret>
```

启动：

```bash
pnpm dev
```

访问 <http://localhost:5000/register>。运行时始终调用真实模型；配置 Tavily 后调用在线搜索服务。

### 自动测试与真实 LLM 评估

自动测试在测试级预定义桩中验证流程，不依赖确定性 Agent 模式。真实 LLM 输出具有动态性，使用固定样本按[基线报告评测规则](../evaluation/baseline-rubric.md)人工评估。

## 4. 真实前台 Agent 与 Tavily

生产环境唯一支持的适配器是 `openai-compatible`。前台 Agent 使用 OpenAI 兼容协议调用模型；
配置 Tavily 时，联网搜索独立走 Tavily。把以下必填变量写入运行环境：

```dotenv
AGENT_ADAPTER=openai-compatible
LLM_BASE_URL=https://<provider-host>/v1
LLM_API_KEY=<secret>
LLM_MODEL_ID=<model-id>
LLM_INPUT_USD_PER_MILLION=<non-negative-number>
LLM_OUTPUT_USD_PER_MILLION=<non-negative-number>
```

需要联网搜索时再额外配置 `TAVILY_API_KEY=<secret>`。

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
2. 给 Web 应用和 Trigger.dev 任务配置同一组 `DATABASE_URL`、LLM 和价格变量；需要在线搜索时，再为两者配置相同的 Tavily Key。
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

任务 ID 固定为 `run-agent`。每次派发只携带 `workspaceId` 和 `agentRunId`：Web 应用先持久化
`queued` Agent run，Trigger 任务使用自身 run ID 认领它并进入 `running`，再把取消信号传给
工作空间 Agent runtime。部署后确认 Trigger.dev 控制台只能看到当前的 `run-agent` 定义，不应再出现
旧任务定义，然后再发布使用 `ANALYSIS_RUNTIME=trigger` 的 Web 应用。用户终止运行时，派发器调用
`runs.cancel(triggerRunId)`；Trigger.dev 任务收到的 `signal` 会继续传入模型、搜索和专家工具。

## 6. 状态与稳定错误码

工作空间与最新 Agent run 状态：

| 状态 | 含义 | 操作 |
| --- | --- | --- |
| `queued` | 已持久化，等待后台执行 | 检查派发器和 Trigger.dev |
| `running` | 专家或综合流程正在执行 | 等待 SSE；断线时客户端自动轮询 |
| `interrupted` | 用户已终止最新 Agent run | 检查原因后从该 run 继续 |
| `completed` | 六个模块均可用 | 无 |
| `recoverable` | Agent、专家、信源或派发失败，已完成内容保留 | 按恢复流程继续 |

模块状态为 `queued`、`running`、`completed` 或 `failed`。失败模块保留已完成模块及其版本。

可直接用于告警与操作判断的稳定错误码：

| 类别 | 错误码 |
| --- | --- |
| 输入 | `EMPTY`、`TOO_LONG`、`UNSAFE_CONTENT` |
| Agent 与派发 | `DISPATCH_FAILED`、`AGENT_RUN_INTERRUPTED`、`REQUIRED_TOOL_UNAVAILABLE` |
| 专家 | `EXPERT_FAILED`、`EXPERT_TIMEOUT`、`INVALID_EXPERT_OUTPUT` |
| LLM | `LLM_AUTHENTICATION_FAILED`、`LLM_RATE_LIMITED`、`LLM_TIMEOUT`、`LLM_SCHEMA_INVALID`、`LLM_UNKNOWN_ERROR` |
| 搜索 | `SEARCH_AUTHENTICATION_FAILED`、`SEARCH_RATE_LIMITED`、`SEARCH_QUERY_TOO_LONG`、`SEARCH_UNAVAILABLE`、`SEARCH_UNKNOWN_ERROR` |

表中的英文错误码用于 Agent run、事件和安全日志诊断；它们不是当前 HTTP API 的响应字段。读取快照或事件时，未登录返回 `401` 和“请先登录”，资源不属于当前用户或不存在时统一返回 `404` 和“分析不存在”。重试路由成功返回 `202`；终止和继续成功返回 `200`。不支持的操作返回 `400`，状态冲突返回 `409`，派发失败返回 `503`，响应正文均为中文 `error`。跨用户访问统一表现为 `404`，不要向调用方泄露资源是否存在。

## 7. 重试与恢复

### 已配置搜索时的信源故障

1. 确认工作空间与最新 Agent run 为 `recoverable`，`sources` 为 `failed`，其他已完成专家模块仍可用。
2. 确认该环境已配置 Tavily 后，检查凭据、配额和连通性。
3. 用户在报告页选择“继续分析”，或按“可恢复任务”步骤调用 resume API。接口创建新的基线 Agent run，复用工作空间中已持久化的工具产物和模块版本，重新执行失败的信源工具。
4. 新 run 必须继续执行尚未完成的综合、二次审校、修订和发布检查；确认这些工具完成后，工作空间转为 `completed`，原有内容模块仍可用。

### 可恢复任务

1. 用 `workspaceId` 和快照中的 `activeRun.id` 查 Trigger.dev 运行和安全日志，只读取错误码、尝试次数和耗时。
2. 修复凭据、配额或 worker 故障。
3. 对最新状态为 `interrupted` 或 `recoverable` 的 Agent run，在已登录且通过同源校验的客户端调用
   `POST /api/analyses/<workspaceId>/runs/<agentRunId>/resume`。接口会创建新的 run，复用前序 run 的
   kind、configVersion 和工作空间上下文，并以 `${workspaceId}:${newAgentRunId}` 作为派发幂等键。
4. 需要主动终止 `queued`、`running` 或 `recoverable` 的最新 run 时，调用
   `POST /api/analyses/<workspaceId>/runs/<agentRunId>/cancel`。服务端先持久化 `interrupted`，再取消
   对应 Trigger run；后续工具写入会被仓储守卫拒绝。页面显示“任务已终止”和“继续分析”后，确认
   已完成模块与安全专家摘要仍在工作空间快照中。

继续和终止都只接受当前用户工作空间中的最新 run；不存在、非所属或过期 run ID 统一返回 `404`，
状态冲突返回 `409`。成功响应是最新工作空间快照。操作前后读取 `GET /api/analyses/<workspaceId>`，
确认新 run 的状态与已完成模块版本没有回退。所有恢复都通过 Agent run 生命周期执行。

## 8. 安全日志与 OpenTelemetry

结构化日志只允许记录 `workspaceId`、`agentRunId`、`operation`、`errorCode`、`durationMs`、`attempt` 等运行元数据。不得记录完整原文、用户名、密码、认证会话令牌、prompt、模型 response、API key 或任意未经筛选的异常对象。

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
| 报告成功率 | `>= 90%` |
| 首模块 P95 | `<= 10s` |
| 完整基线 P95 | `<= 60s` |

逐列定义和填写示例见 [基线报告评测规则](../evaluation/baseline-rubric.md)。

## 10. 配置版本回滚

工作空间持久化 `baseline-v1`，每个 Agent run 持久化自己的 `agent-v1` configVersion。不要直接更新数据库中的版本字段。回滚以已验证的 Git release ref 为单位，同时回滚 Web 与 Trigger.dev 任务：

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
3. 在另一次分析中看到首个专家摘要后选择“终止任务”，确认页面提供“继续分析”，且已完成模块和摘要未丢失；继续后报告完成。
4. 若配置了 Tavily，打开一个外部信源，确认标题、发布者、日期和链接可用。
5. 从历史记录重新打开报告，再退出登录。
6. 确认每次运行只有一次 `run-agent` 派发，工作空间快照中的 Agent run 按
   `queued -> running -> completed` 转换，OTel 有对应 job/expert spans，日志没有原文或身份凭据。

真实服务 gate 还必须完成 `pnpm eval:run` 和双评审后的 `pnpm eval:score`。

## 12. 密钥轮换

1. 在 LLM、Trigger.dev，以及已启用时的 Tavily 供应商创建新密钥，旧密钥暂不撤销。
2. 同时更新 Web 和 Trigger.dev Cloud 环境变量并重新部署。
3. 运行 `pnpm probe:llm` 和生产 smoke checks。
4. 确认新任务成功后撤销旧密钥。

`AUTH_SECRET` 当前用于认证限流键的 HMAC；轮换会切换限流键空间，但不会主动撤销数据库中的认证会话。若事件要求所有用户重新登录，在部署新 secret 后显式撤销活动认证会话：

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL;"
```

密钥只进入受控 secret store，不写入仓库、日志、Trace、评测产物或工单正文。
