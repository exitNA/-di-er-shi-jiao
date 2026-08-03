# 本地 Langfuse 全链路观察设计

## 目标

在本地通过 Docker Compose 部署 Langfuse，并以 Langfuse 原生 OpenTelemetry 接入替换现有通用 OTLP 导出。一次分析任务在 Langfuse 中呈现从客户经理到专家、Pi 模型、工具和报告发布的完整调用树，支持调试与分析。

## 范围

- 本地部署 Langfuse Web、Worker、PostgreSQL、ClickHouse、Redis 与 MinIO，使用官方 Compose 拓扑和持久化卷。
- 应用使用 Langfuse TypeScript/OpenTelemetry 集成作为唯一的 tracing 出口。
- 记录用户标识、workspace、原始材料、提示词、模型输入输出、工具参数结果、来源 URL、token、成本、错误与完整父子关系。
- 前端 AG-UI/SSE 仍保留既有脱敏边界；Langfuse 的详细调试数据不进入浏览器事件。
- 移除通用 OTLP exporter、`OTEL_EXPORTER_OTLP_ENDPOINT` 及其对应配置、文档、日志和依赖，不保留兼容路径。

## 架构

`compose.langfuse.yaml` 是独立的本地观测 Compose 栈。Langfuse Web 对宿主机提供 `http://localhost:3000`；其 PostgreSQL、ClickHouse、Redis 和 MinIO 仅在 Compose 网络中通信，避免与应用 PostgreSQL 冲突。

应用仅配置：

- `LANGFUSE_BASE_URL`
- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`
- `LANGFUSE_TRACING_ENVIRONMENT=local`

`instrumentation.ts` 在 Node 运行时启动 Langfuse 的 OTel span processor。没有完整 Langfuse 配置时启动失败，确保本地开发不会悄然丢失观测数据。

## 追踪模型

每个分析任务创建一个 trace，携带用户、workspace、运行类型和原始材料。trace 内部按调用上下文嵌套：

1. manager chain：运行输入、协调提示、状态和最终结果；
2. expert generation：专家标识、实际提示词、模型输入输出、模型名、token、成本、错误；
3. tool span：搜索、专家委派和报告动作的完整参数、结果、来源 URL 与状态；
4. report action：审校、修订和发布的持久化结果。

Pi event 负责将模型 turn、文本、工具开始/结束与错误映射为 generation/tool observations。业务执行器为持久化动作和搜索创建 spans。异常记录为 ERROR，取消记录为取消状态而非成功。

## 本地使用

提供 `pnpm langfuse:up` 与 `pnpm langfuse:down`。启动命令生成本地随机 secrets、启动服务并等待健康状态；首次启动预置本地组织、项目、管理员和项目 API key，将应用连接信息写入未跟踪的 `.env.langfuse.local`。停止命令不删除 volumes，保留调试历史。

## 验证

- 单元测试验证 Langfuse trace 父子关系、详细 I/O、工具结果、错误与取消状态。
- `docker compose -f compose.langfuse.yaml config` 校验部署文件。
- 手工验收：启动 Langfuse，执行一次分析，在 UI 中查看 manager、五类专家、模型 generation、搜索/报告工具、token/成本及失败状态。

## 非目标

- 不实现 Langfuse Cloud、远程生产部署或双写 OTLP。
- 不改变前端事件公开内容或放宽其脱敏规则。
- 不引入 E2E 测试；仓库规范明确禁止编写或运行 E2E。
