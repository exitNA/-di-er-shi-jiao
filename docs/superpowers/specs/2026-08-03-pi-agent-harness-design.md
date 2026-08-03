# Pi Agent Harness 设计

## 目标

以 Pi SDK 替换当前固定的 AI SDK 工具循环，为面向客户的开放式多 agent 协作提供服务端 harness，同时保持现有产品的权限、报告版本与事件流行为。

## 适用范围

本设计覆盖 `manager` 与五个专家 agent 的运行边界、目录约定、跨 agent 调用、业务持久化与恢复。前端继续消费现有事件流；Postgres 继续保存业务事实。

## Agent 拓扑

所有 agent 技术上平级：

```text
src/server/agents/
├─ manager/
├─ argument/
├─ sources/
├─ perspectives/
├─ risks/
└─ synthesis/
```

`manager` 是直接对接客户的客户经理：理解需求、发起与协调专家任务、追问、汇总与交付。其余目录是独立专家。专家不互相调用；跨 agent 协作只由 manager 发起与追踪。

每个 agent 目录包含：

```text
agent.ts       # Pi harness 与受控入口
prompts/       # Markdown 模板
skills/        # 按需加载的能力包
tools/         # 本地受信任工具
mcp/           # MCP 配置或适配器
plugins/       # Pi extension 或 package 集成
```

共享模型配置、Pi 会话适配、业务工具契约和事件桥接放在 `src/server/agents/shared/`。

## 运行模型

每个 agent 在服务端使用 Pi SDK 运行自己的 harness，并只加载本 agent 的 prompt、skills、extensions 和 tools。Pi session 保存会话上下文，不作为产品业务记录。

manager 通过本地协调工具调用平级专家。工具输入包含业务 run ID、工作空间 ID 与用户授权范围；这些值由服务端提供，不允许模型自行指定。专家返回通过 schema 校验的结构化结果，manager 可以继续追问、重试、改派或交付。

不定义固定专家调用顺序。manager 根据客户需求选择、并行或迭代调用专家；每个 agent 的工具契约和业务写入边界保持确定。

## 业务事实与安全边界

Postgres 是用户、权限、工作空间、报告版本、任务状态与事件的唯一事实来源。Pi 会话、MCP 结果和模型输出均是暂态或派生信息。

所有业务写操作通过服务端受信任工具执行。工具在执行前校验授权、运行状态、版本与幂等条件；模型不能直接访问数据库或越过这些校验。搜索、MCP 和 skill 工具通过各 agent 的工具边界接入。

## 执行、失败与可观测性

manager 收到客户消息后创建业务 run。每次专家调用创建关联的子 run，并把已验证的结果和摘要写入现有报告模块与 AG-UI 事件流。

取消、超时与失败由工具以明确结果返回。manager 决定是否重试、改派专家或向客户说明证据缺口。前端只读取事件流，不接触 Pi、MCP 或模型凭据。

## 验收条件

- manager 与五个专家均可独立加载其 Pi harness 和本地能力。
- manager 能通过受信任工具协调任意一个或多个平级专家，而不依赖固定 workflow。
- 无权限、版本冲突、取消与失败不能产生未经校验的业务写入。
- 已有报告模块、版本、工作空间授权和 AG-UI 事件语义保持可用。
- 每个 agent 的 skill/tool 有单测；manager 协作有集成测试；关键客户路径有端到端覆盖。
