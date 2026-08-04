# 本地 Opik 与 Langfuse 原生双写观察设计

## 目标

保留已部署的本地 Langfuse，在同一次分析任务中同步写入本地自托管 Opik。两套平台各自接收其 TypeScript SDK 的原生 trace/span 语义，用于对比完整调用树、I/O、错误、token、成本、评测与分析视图。

## 范围

- 本地部署独立 Opik Docker Compose 栈，并提供 `pnpm opik:up`、`pnpm opik:down`。
- 应用新增 Opik TypeScript SDK 和本地连接配置。
- 将 Langfuse 专属 `withLangfuseObservation` 改为中立的观测入口，同时创建和结束 Langfuse observation 与 Opik span。
- 将 Pi 模型 turn 纳入同一双写入口，记录原生 LLM span 的提示词、消息、输出、模型、token、成本与错误。
- 继续仅将脱敏运行元数据写入结构化日志和浏览器 SSE；完整观测数据仅发送至两套本地观察平台。

## 架构

不使用 OTel Collector。Collector 只能转发标准 OTLP 语义，无法让两端都获得完整的原生字段和类型。

`src/server/observability/` 提供中立的 trace/observation 生命周期：分析任务创建 Langfuse trace 与 Opik trace；agent、chain、retriever、tool 和 generation 分别映射至两端原生类型。该层统一处理输入、输出、metadata、错误和结束，不改变业务调用点。

Pi session 的 generation 也通过该中立入口创建。工具调用继续在模型 generation 的上下文内执行，保持每个平台内的父子链路一致。

## 本地使用

Opik 使用官方本地 Docker 部署，UI 暴露在其默认本地端口。`opik:up` 将必需的本地 Opik 配置写入未跟踪的 `.env`，启动并等待服务就绪；`opik:down` 停止服务并保留 volumes。应用启动时校验 Langfuse 和 Opik 两组本地配置，缺失时失败，避免静默丢失任一侧数据。

## 验证

- 单元测试覆盖中立观测层的成功、异常与父子关系，断言两个 SDK 都收到相同的业务输入、输出与状态。
- Opik Compose 与 Langfuse Compose 分别执行 `docker compose config`。
- 手工执行一次含搜索的分析，在两个 UI 中确认 manager、五类专家、模型 generation、搜索、报告动作、I/O、错误、token 与成本可见且层级完整。

## 非目标

- 不加入 OTel Collector、云端 Opik/Langfuse、生产部署或 E2E 测试。
- 不将任一平台的敏感观测内容暴露到结构化日志、API 或前端 SSE。
