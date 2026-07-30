## 项目技术栈

本项目使用 Next.js + TypeScript，基于 React 实现前后端一体的全栈应用。

## 文档语言

项目文档默认使用中文；代码标识符、命令、路径和专有名词保留原文。

## 文档表达

产品、设计和叙事文档以目标、能力、适用范围和替代路径组织内容，采用正向表述。安全边界与验收条件保留精确语义，重复的排除项直接精简。

## 测试规范

- 单元与组件：Vitest + React Testing Library + `@testing-library/jest-dom`。
- 端到端：Playwright；仅覆盖关键用户路径。
- API Mock：MSW，按需引入。
- `tests/unit/`：`*.test.ts`、`*.test.tsx`；`tests/e2e/`：`*.spec.ts`。
- 优先断言用户可见行为和业务结果；使用语义化查询，不依赖 DOM 结构。
- Mock 时间、随机性和外部服务；业务规则保持真实执行。

## Agent skills

### Issue tracker（问题跟踪器）

Issue 和 PRD 统一记录在本仓库的 GitHub Issues 中。详见 `docs/agents/issue-tracker.md`。

### Triage labels（分诊标签）

分诊使用五个标准标签名称。详见 `docs/agents/triage-labels.md`。

### Domain docs（领域文档）

领域文档采用 single-context（单上下文）布局。详见 `docs/agents/domain.md`。
