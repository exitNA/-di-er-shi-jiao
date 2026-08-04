# Opik 增量 Agent Graph 与双平台对照设计

## 目标

每次分析在 Opik 中展示本次实际执行的 Agent DAG，并在执行过程中持续更新。Langfuse 与 Opik 保留一致的通用观测信息，使两套平台可以对同一运行进行客观对照。

## 适用范围

- 分析 trace 内的 manager、chain、retriever、tool 与 generation observation。
- 每一个实际创建的 observation 都是一个独立节点；同名的重复调用保留为多个节点。
- 节点开始时写入节点和父边，结束、取消或失败时更新对应状态与耗时。
- 结构发生变化时更新 Opik trace metadata 中的 `_opik_graph_definition`。trace 结束时写入最终快照。
- Opik UI 在下一次数据刷新时展示当前图；应用不新增图查询 API 或浏览器推送通道。

## 图模型

观测层在每个 `withAnalysisTrace` 生命周期内维护一个运行时图：

- root trace 是唯一根节点。
- 每个 `startObservation` 以自增序号获得稳定、Mermaid 安全的节点 ID。
- 节点的父级来自当前 OpenTelemetry observation 上下文，与现有 Opik span 和 Langfuse observation 父子关系使用同一来源。
- 标签包含 observation 名称、类型、实例序号；结束后追加结果状态和耗时。标签不写入原始材料、提示词、模型输出、用户标识或工具参数。
- Mermaid 采用 `flowchart TD`。成功、运行中、取消和失败以样式区分；失败节点保留在图中。

## 双平台对照契约

以下字段必须由同一个中立观测入口同步到 Langfuse 与 Opik：

- trace 与 observation 名称、类型和实际父子关系；
- input、output 与 metadata；
- 模型、token 使用量与成本；
- 成功、错误、取消及状态消息；
- trace 的用户、workspace/session 与分析类型。

`_opik_graph_definition` 是 Opik 专用的附加 metadata，不替换或删减上述通用字段。Langfuse 不写入伪造图字段；其原生调用树继续由相同的 observation 层级渲染。

## 写入与错误处理

- 只在 observation 开始、结束和异常结束时更新图，避免按 token 或日志事件写入。
- 图 metadata 与原 trace metadata 合并，绝不覆盖 `kind`、`userId` 或 `workspaceId`。
- 图序列化失败不得改变分析业务结果；观测层保留原有错误处理与结束语义。
- 每个 observation 即使多次调用 `end()` 也只更新图并结束一次。

## 验收

- 一个含重复 generation、嵌套 tool 和失败节点的测试运行生成独立节点和正确边。
- 开始 observation 后 Opik trace 收到运行中图；结束后收到带状态和耗时的最终图。
- 现有 Langfuse observation 与 Opik span 的名称、类型、层级、I/O、metadata、模型、token、成本与错误断言全部继续成立。
- Opik 本地栈健康，实际 SDK trace/span flush 无 500。

## 替代路径

不从已落库 span 反推图：异步批量写入会使运行中图滞后并可能遗漏节点。也不使用静态流程模板：模板无法呈现实际分支、重试、失败和重复调用。
