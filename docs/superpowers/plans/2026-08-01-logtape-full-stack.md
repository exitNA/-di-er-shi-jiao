# LogTape Full-Stack Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 用 LogTape 替换自定义服务端日志，并接入前端错误边界。

**Architecture:** 应用入口分别配置一次 console sink；业务代码按功能分类获取 LogTape logger。

**Tech Stack:** Next.js、TypeScript、`@logtape/logtape`。

## Global Constraints

- 只使用 console sink，不发送远程日志。
- 不记录连接串、密钥、令牌或原始材料。

### Task 1: 配置并迁移日志

**Files:**
- Modify: `package.json`, `src/instrumentation.ts`, `src/server.ts`, `src/features/analysis/server/submit-analysis.ts`, `src/server/agents/baseline-orchestrator.ts`, `src/app/error.tsx`, `src/app/global-error.tsx`
- Create: `src/instrumentation-client.ts`
- Delete: `src/server/observability/logger.ts`, `tests/unit/server/observability/logger.test.ts`

- [ ] 添加 `@logtape/logtape`，在两个 instrumentation 入口配置 `second-perspective` console logger。
- [ ] 以 LogTape logger 替换服务端自定义日志与前端 `console.error`。
- [ ] 删除旧模块与测试，验证无残留导入、类型检查及启动日志。
