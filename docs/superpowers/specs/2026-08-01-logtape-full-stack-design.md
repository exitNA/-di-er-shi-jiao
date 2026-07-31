# LogTape 全栈日志设计

## 目标

使用 `@logtape/logtape` 统一服务端与浏览器日志，删除现有自定义日志模块。

## 架构

服务端在 `src/instrumentation.ts` 的 `register()` 中配置 LogTape；浏览器在 `src/instrumentation-client.ts` 中同步配置。两端均使用 console sink，日志按 `second-perspective` 根分类及功能子分类组织。

## 范围

- 删除 `src/server/observability/logger.ts`。
- 将分析提交、编排、HTTP 服务启动和前端错误边界改为 LogTape。
- 保留现有允许的业务元数据，且不输出数据库连接串、密码、令牌、API Key 或原始材料。
- 不增加远程日志上报、文件 sink、外部平台或额外 LogTape 插件。

## 验收

- 服务端与客户端入口均在应用启动前配置 LogTape。
- 旧自定义日志模块及其导入均不存在。
- 关键服务端错误和前端错误边界通过 LogTape 输出。
- 类型检查通过。
