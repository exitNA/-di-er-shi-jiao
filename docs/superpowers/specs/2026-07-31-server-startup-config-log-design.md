# 服务启动配置日志设计

## 目标

在自定义 HTTP 服务成功监听后输出一条结构化 JSON 日志，便于云日志检索启动环境与运行模式。

## 输出内容

日志包含监听地址、端口、Node 环境、Coze 项目环境、Agent 适配器和分析运行时。数据库、认证、LLM、Tavily、Trigger 与遥测配置只输出布尔状态，不输出连接串、密钥或其他敏感值。

## 实现

在 `src/server.ts` 的 `server.listen` 回调中新增一个 `console.info(JSON.stringify(...))` 调用，事件名固定为 `server_started`。保留现有可读的监听地址日志。

## 验收

- 服务启动时输出一条可解析 JSON。
- JSON 不含 `DATABASE_URL`、`AUTH_SECRET`、API Key 或其他敏感值。
- 开发服务仍可正常启动并响应请求。
