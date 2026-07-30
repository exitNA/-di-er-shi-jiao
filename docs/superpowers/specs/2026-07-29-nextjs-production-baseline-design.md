# Next.js 生产基线设计

## 目标

在仓库根目录初始化一个可运行、可构建、平台中立的 Next.js 全栈应用基线。项目使用 React、TypeScript、App Router、Tailwind CSS、ESLint 和 pnpm，并将应用代码放在 `src/` 中。

初始化聚焦当前需要的框架入口和已确认的占位目录，数据库、状态管理、认证、测试、容器和部署能力由对应功能设计引入。

## 技术决策

- 使用初始化时最新稳定版 Next.js，并由 `pnpm-lock.yaml` 固定完整依赖版本。
- 使用 App Router 和 React Server Components；组件需要浏览器交互时才添加 `"use client"`。
- 使用 TypeScript，并通过 `tsc --noEmit` 独立执行类型检查。
- 使用 Tailwind CSS 处理样式，保留 `src/app/globals.css` 作为全局样式入口。
- 使用 ESLint 执行静态检查。
- 使用 pnpm 管理依赖。
- 使用标准 `next build` 和 `next start`，保持托管与容器方案的选择空间。

## 目录结构

```text
/
├── AGENTS.md
├── README.md
├── docs/
├── public/
│   └── .gitkeep
├── src/
│   ├── app/
│   │   ├── favicon.ico
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── error.tsx
│   │   ├── global-error.tsx
│   │   └── not-found.tsx
│   ├── components/
│   │   └── .gitkeep
│   ├── features/
│   │   └── .gitkeep
│   ├── hooks/
│   │   └── .gitkeep
│   ├── lib/
│   │   └── .gitkeep
│   ├── server/
│   │   └── .gitkeep
│   └── types/
│       └── .gitkeep
├── tests/
│   ├── unit/
│   │   └── .gitkeep
│   └── e2e/
│       └── .gitkeep
├── .gitignore
├── eslint.config.mjs
├── next.config.ts
├── package.json
├── pnpm-lock.yaml
├── postcss.config.mjs
└── tsconfig.json
```

## 目录职责

- `src/app/`：只承载路由、布局、路由级状态和 Next.js 特殊文件。
- `src/components/`：跨功能复用的 React 组件。
- `src/features/`：按产品能力组织的垂直业务模块；具体模块在首个功能实现时创建。
- `src/hooks/`：跨功能复用的客户端 React Hooks。
- `src/lib/`：服务多个业务功能的共享代码。
- `src/server/`：仅在服务端运行的集成和基础设施代码。
- `src/types/`：确实跨多个功能共享的 TypeScript 类型。
- `tests/unit/`：单元和轻量集成测试的预留位置。
- `tests/e2e/`：端到端测试的预留位置。
- `public/`：通过根路径直接提供的静态资源。

空目录使用 `.gitkeep` 纳入版本控制。`utils/`、`services/`、`store/`、`config/` 和 `api/` 在出现明确职责或依赖后创建。API Route Handler 按需放在 `src/app/api/**/route.ts`。

## 应用入口与错误处理

- `layout.tsx` 提供根 HTML 结构、全局元数据和全局样式入口。
- `page.tsx` 提供可访问的最小首页，证明应用能够渲染。
- `error.tsx` 提供路由级错误边界和重试入口。
- `global-error.tsx` 捕获根布局范围的未处理异常，并输出完整的 HTML 回退界面。
- `not-found.tsx` 提供可访问的 404 页面和返回首页入口。

错误页面保持最小，监控或日志服务在完成选型后接入。

## 项目脚本

`package.json` 提供以下脚本：

- `pnpm dev`：启动本地开发服务器。
- `pnpm build`：生成生产构建。
- `pnpm start`：启动生产服务器。
- `pnpm lint`：运行 ESLint。
- `pnpm typecheck`：运行 `tsc --noEmit`。

## 文档和现有文件

- 保留现有 `AGENTS.md`、`docs/agents/` 和 `docs/meeting-notes/`。
- 合并 Next.js 所需的 `.gitignore` 规则，并保留仓库已有内容。
- 更新 `README.md`，记录安装、开发、检查、构建和启动命令。

## 验证

初始化完成后执行：

1. `pnpm lint`
2. `pnpm typecheck`
3. `pnpm build`

随后以生产模式启动应用，对首页和缺省路径执行最小烟雾检查。当前基线通过构建、启动和烟雾检查完成验证；首次实现可测试业务行为时，再选择并配置相应测试工具。

## 参考

- [Next.js App Router](https://nextjs.org/docs/app)
- [Next.js 项目结构](https://nextjs.org/docs/app/getting-started/project-structure)
- [Next.js 生产检查清单](https://nextjs.org/docs/app/guides/production-checklist)
