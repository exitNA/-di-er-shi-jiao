## 项目技术栈

### 版本技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 6
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4

## 文档语言

项目文档默认使用中文；代码标识符、命令、路径和专有名词保留原文。

## 文档表达

产品、设计和叙事文档以目标、能力、适用范围和替代路径组织内容，采用正向表述。安全边界与验收条件保留精确语义，重复的排除项直接精简。


## 包管理规范

**仅允许使用 pnpm** 作为包管理器，**严禁使用 npm 或 yarn**。
**常用命令**：
- 安装依赖：`pnpm add <package>`
- 安装开发依赖：`pnpm add -D <package>`
- 安装所有依赖：`pnpm install`
- 移除依赖：`pnpm remove <package>`

## 开发规范

### 开发流程

- 简单、边界清晰的开发任务直接实施，无需使用 `brainstorming` 创建设计文档；仅在需求存在重要产品或技术取舍时再进行设计探索。

### 编码规范

- 默认按 TypeScript `strict` 心智写代码；优先复用当前作用域已声明的变量、函数、类型和导入，禁止引用未声明标识符或拼错变量名。
- 禁止隐式 `any` 和 `as any`；函数参数、返回值、解构项、事件对象、`catch` 错误在使用前应有明确类型或先完成类型收窄，并清理未使用的变量和导入。
- 本项目从零开发，不保留旧版本、旧数据、旧接口或迁移期兼容路径。功能替换时直接删除旧调用方、配置、测试和文档；仅保留当前产品路径实际调用的代码。

### next.config 配置规范

- 配置的路径不要写死绝对路径，必须使用 path.resolve(__dirname, ...)、import.meta.dirname 或 process.cwd() 动态拼接。

### Hydration 问题防范

1. 严禁在 JSX 渲染逻辑中直接使用 typeof window、Date.now()、Math.random() 等动态数据。**必须使用 'use client' 并配合 useEffect + useState 确保动态内容仅在客户端挂载后渲染**；同时严禁非法 HTML 嵌套（如 <p> 嵌套 <div>）。
2. **禁止使用 head 标签**，优先使用 metadata，详见文档：https://nextjs.org/docs/app/api-reference/functions/generate-metadata
   1. 三方 CSS、字体等资源可在 `globals.css` 中顶部通过 `@import` 引入或使用 next/font
   2. preload, preconnect, dns-prefetch 通过 ReactDOM 的 preload、preconnect、dns-prefetch 方法引入
   3. json-ld 可阅读 https://nextjs.org/docs/app/guides/json-ld

## UI 设计与组件规范 (UI & Styling Standards)

- 模板默认预装核心组件库 `shadcn/ui`，位于`src/components/ui/`目录下
- Next.js 项目**必须默认**采用 shadcn/ui 组件、风格和规范，**除非用户指定用其他的组件和规范。**

## 测试规范

- 单元与组件：Vitest + React Testing Library + `@testing-library/jest-dom`。
- 不编写或运行端到端（E2E）测试；关键用户路径由用户手工测试。
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
