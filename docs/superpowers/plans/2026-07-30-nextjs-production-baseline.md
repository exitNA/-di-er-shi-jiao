# Next.js Production Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在仓库根目录交付一个可运行、可检查、可生产构建的 Next.js 全栈应用基线。

**Architecture:** 使用官方 `create-next-app` 生成 App Router、TypeScript、Tailwind CSS 和 ESLint 基线，再将生成结果有选择地合并到现有仓库。应用代码位于 `src/`；路由入口留在 `src/app/`，共享代码和测试位置以可追踪的空目录预留。

**Tech Stack:** Next.js、React、TypeScript、Tailwind CSS、ESLint、pnpm

## Global Constraints

- 使用初始化时最新稳定版 Next.js，并由 `pnpm-lock.yaml` 固定完整依赖版本。
- 使用 App Router 和 React Server Components；组件需要浏览器交互时才添加 `"use client"`。
- 使用 `src/` 目录、TypeScript、Tailwind CSS、ESLint 和 pnpm。
- 使用标准 `next build` 和 `next start`，保持托管与容器方案的选择空间。
- 保留现有 `AGENTS.md`、`docs/agents/`、`docs/meeting-notes/` 以及工作区中属于其他计划的改动。
- 现有暂存区包含其他文件；每次提交使用明确路径执行 `git add`。
- 本计划聚焦应用基线；数据库、状态管理、认证、监控、测试框架、环境变量模板和 CI 由对应功能计划引入。

## File Map

- Create: `package.json` — 依赖和 `dev`、`build`、`start`、`lint`、`typecheck` 脚本。
- Create: `pnpm-lock.yaml` — 固定完整依赖图。
- Create: `eslint.config.mjs` — Next.js 和 TypeScript ESLint 配置。
- Create: `next.config.ts` — Next.js 配置入口。
- Create: `postcss.config.mjs` — Tailwind CSS 的 PostCSS 配置。
- Create: `tsconfig.json` — TypeScript 和 `@/*` 路径别名配置。
- Modify: `.gitignore` — 合并 Next.js、Node.js、构建和本地环境文件规则。
- Modify: `README.md` — 记录运行、检查和构建命令。
- Create: `src/app/layout.tsx` — 根布局和元数据。
- Create: `src/app/page.tsx` — 最小可访问首页。
- Create: `src/app/globals.css` — Tailwind CSS 和基础全局样式入口。
- Create: `src/app/favicon.ico` — 应用图标。
- Create: `src/app/error.tsx` — 路由级错误回退和重试。
- Create: `src/app/global-error.tsx` — 根级错误回退。
- Create: `src/app/not-found.tsx` — 404 回退。
- Create: `public/.gitkeep` — 静态资源目录占位。
- Create: `src/{components,features,hooks,lib,server,types}/.gitkeep` — 应用边界占位。
- Create: `tests/{unit,e2e}/.gitkeep` — 测试目录占位。

---

### Task 1: Generate and merge the official framework baseline

**Files:**
- Create: `package.json`
- Create: `pnpm-lock.yaml`
- Create: `eslint.config.mjs`
- Create: `next.config.ts`
- Create: `postcss.config.mjs`
- Create: `tsconfig.json`
- Create: `src/app/favicon.ico`
- Create: `src/app/globals.css`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: the repository root and the approved design at `docs/superpowers/specs/2026-07-29-nextjs-production-baseline-design.md`.
- Produces: a runnable Next.js application with scripts `dev`, `build`, `start`, `lint`, and `typecheck`.

- [ ] **Step 1: Confirm protected files and current staging state**

Run:

```bash
git status --short
test -f AGENTS.md
test -d docs/agents
test -d docs/meeting-notes
test ! -e package.json
test ! -e src
```

Expected: all `test` commands exit `0`; status may show existing staged agent configuration and untracked meeting notes.

- [ ] **Step 2: Generate the official scaffold in an isolated temporary directory**

Run:

```bash
baseline_tmp_root="$(mktemp -d /tmp/second-perspective-next.XXXXXX)"
pnpm dlx create-next-app@latest "$baseline_tmp_root/second-perspective" \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --turbopack \
  --import-alias "@/*" \
  --use-pnpm \
  --yes
baseline_source="$baseline_tmp_root/second-perspective"
test -f "$baseline_source/package.json"
test -f "$baseline_source/pnpm-lock.yaml"
test -f "$baseline_source/src/app/page.tsx"
```

Expected: `create-next-app` exits `0` and the three generated files exist.

- [ ] **Step 3: Copy only approved framework files into the repository**

Run from the repository root:

```bash
cp "$baseline_source/package.json" package.json
cp "$baseline_source/pnpm-lock.yaml" pnpm-lock.yaml
cp "$baseline_source/eslint.config.mjs" eslint.config.mjs
cp "$baseline_source/next.config.ts" next.config.ts
cp "$baseline_source/postcss.config.mjs" postcss.config.mjs
cp "$baseline_source/tsconfig.json" tsconfig.json
cp -R "$baseline_source/src" src
pnpm pkg set scripts.typecheck="tsc --noEmit"
```

Do not copy the generated `README.md`, `.gitignore`, `.git/`, `node_modules/`, or decorative files from `public/`.

- [ ] **Step 4: Merge the Next.js ignore rules without dropping the existing first line**

Make `.gitignore` exactly:

```gitignore
# -v

# dependencies
/node_modules
/.pnp
.pnp.*
.yarn/*
!.yarn/patches
!.yarn/plugins
!.yarn/releases
!.yarn/versions

# testing
/coverage

# next.js
/.next/
/out/

# production
/build

# misc
.DS_Store
*.pem

# debug
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.pnpm-debug.log*

# local env files
.env*

# typescript
*.tsbuildinfo
next-env.d.ts
```

- [ ] **Step 5: Install the root dependencies and verify the generated baseline**

Run:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm build
```

Expected: every command exits `0`; the build output includes route `/`.

- [ ] **Step 6: Remove only the generated temporary directory**

Run:

```bash
case "$baseline_tmp_root" in
  /tmp/second-perspective-next.*) rm -rf -- "$baseline_tmp_root" ;;
  *) echo "Refusing to remove unexpected path: $baseline_tmp_root"; exit 1 ;;
esac
```

Expected: the validated `/tmp/second-perspective-next.*` directory is removed.

- [ ] **Step 7: Commit only the framework baseline**

Run:

```bash
git add .gitignore package.json pnpm-lock.yaml eslint.config.mjs next.config.ts postcss.config.mjs tsconfig.json src/app
git commit --only -m "chore: initialize Next.js application" -- \
  .gitignore package.json pnpm-lock.yaml eslint.config.mjs next.config.ts \
  postcss.config.mjs tsconfig.json src/app
```

Expected: the commit excludes `AGENTS.md`, `docs/agents/`, `docs/meeting-notes/`, and the implementation plan.

### Task 2: Add the production application shell and error fallbacks

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/page.tsx`
- Create: `src/app/error.tsx`
- Create: `src/app/global-error.tsx`
- Create: `src/app/not-found.tsx`

**Interfaces:**
- Consumes: the App Router and Tailwind CSS setup produced by Task 1.
- Produces: route `/`, route-level recovery UI, root-level recovery UI, and a 404 response for unmatched paths.

- [ ] **Step 1: Replace the generated global stylesheet**

Write `src/app/globals.css`:

```css
@import "tailwindcss";

:root {
  color-scheme: light;
  font-family: Arial, Helvetica, sans-serif;
}

body {
  min-height: 100vh;
  margin: 0;
  background: #f7f7f5;
  color: #171717;
}

button,
a {
  font: inherit;
}
```

- [ ] **Step 2: Replace the root layout**

Write `src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "第二视角",
  description: "帮你弄懂复杂议题，把结论留给你。",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Replace the generated home page**

Write `src/app/page.tsx`:

```tsx
export default function Home() {
  return (
    <main className="grid min-h-screen place-items-center px-6 py-16">
      <section className="w-full max-w-3xl">
        <p className="mb-4 text-sm font-medium tracking-[0.2em] text-neutral-500">
          第二视角
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          帮你弄懂复杂议题，把结论留给你。
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-neutral-600">
          AI 认知防火墙，帮助你看清信息结构、观点偏差与隐藏假设。
        </p>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Add the route-level error boundary**

Write `src/app/error.tsx`:

```tsx
"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center px-6 text-center">
      <section>
        <h1 className="text-2xl font-semibold">页面正在恢复</h1>
        <p className="mt-3 text-neutral-600">请稍后重试。</p>
        <button
          className="mt-6 rounded-full bg-neutral-900 px-5 py-2.5 text-white"
          onClick={reset}
          type="button"
        >
          重新加载
        </button>
      </section>
    </main>
  );
}
```

- [ ] **Step 5: Add the root-level error boundary**

Write `src/app/global-error.tsx`:

```tsx
"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body>
        <main className="grid min-h-screen place-items-center px-6 text-center">
          <section>
            <h1 className="text-2xl font-semibold">应用正在恢复</h1>
            <p className="mt-3 text-neutral-600">请稍后重试。</p>
            <button
              className="mt-6 rounded-full bg-neutral-900 px-5 py-2.5 text-white"
              onClick={reset}
              type="button"
            >
              重新加载
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
```

- [ ] **Step 6: Add the not-found page**

Write `src/app/not-found.tsx`:

```tsx
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center">
      <section>
        <p className="text-sm font-medium text-neutral-500">404</p>
        <h1 className="mt-3 text-2xl font-semibold">没有找到这个页面</h1>
        <Link
          className="mt-6 inline-block rounded-full bg-neutral-900 px-5 py-2.5 text-white"
          href="/"
        >
          返回首页
        </Link>
      </section>
    </main>
  );
}
```

- [ ] **Step 7: Verify and commit the production shell**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm build
git add src/app/globals.css src/app/layout.tsx src/app/page.tsx src/app/error.tsx src/app/global-error.tsx src/app/not-found.tsx
git commit -m "feat: add production application shell" -- \
  src/app/globals.css src/app/layout.tsx src/app/page.tsx \
  src/app/error.tsx src/app/global-error.tsx src/app/not-found.tsx
```

Expected: lint, typecheck, and build exit `0`; the commit contains only the six listed files.

### Task 3: Add tracked placeholders, documentation, and final smoke checks

**Files:**
- Create: `public/.gitkeep`
- Create: `src/components/.gitkeep`
- Create: `src/features/.gitkeep`
- Create: `src/hooks/.gitkeep`
- Create: `src/lib/.gitkeep`
- Create: `src/server/.gitkeep`
- Create: `src/types/.gitkeep`
- Create: `tests/unit/.gitkeep`
- Create: `tests/e2e/.gitkeep`
- Modify: `README.md`

**Interfaces:**
- Consumes: the runnable application produced by Tasks 1 and 2.
- Produces: stable extension points, human-facing run instructions, and verified production behavior.

- [ ] **Step 1: Create the approved placeholder directories**

Create each listed `.gitkeep` as a zero-content placeholder:

```text
public/.gitkeep
src/components/.gitkeep
src/features/.gitkeep
src/hooks/.gitkeep
src/lib/.gitkeep
src/server/.gitkeep
src/types/.gitkeep
tests/unit/.gitkeep
tests/e2e/.gitkeep
```

- [ ] **Step 2: Replace the placeholder README**

Write `README.md`:

````markdown
# 第二视角

基于 Next.js、React 和 TypeScript 的全栈应用。

## 环境

- Node.js
- pnpm

## 开发

```bash
pnpm install
pnpm dev
```

访问 <http://localhost:3000>。

## 检查

```bash
pnpm lint
pnpm typecheck
pnpm build
```

## 生产运行

```bash
pnpm start
```
````

- [ ] **Step 3: Verify the directory contract**

Run:

```bash
test -f public/.gitkeep
test -f src/components/.gitkeep
test -f src/features/.gitkeep
test -f src/hooks/.gitkeep
test -f src/lib/.gitkeep
test -f src/server/.gitkeep
test -f src/types/.gitkeep
test -f tests/unit/.gitkeep
test -f tests/e2e/.gitkeep
test ! -d src/utils
test ! -d src/services
test ! -d src/store
test ! -d src/config
```

Expected: every command exits `0`.

- [ ] **Step 4: Run the full static verification**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm build
```

Expected: every command exits `0`.

- [ ] **Step 5: Run production smoke checks**

Start `pnpm start` in a persistent terminal session, then run:

```bash
curl --fail --silent http://127.0.0.1:3000/ | rg "帮你弄懂复杂议题"
curl --silent --output /dev/null --write-out "%{http_code}" http://127.0.0.1:3000/missing-page-smoke-test
```

Expected: the first command prints the home-page phrase; the second prints `404`. Stop the production server after both checks.

- [ ] **Step 6: Commit the placeholders and README using explicit paths**

Run:

```bash
git add README.md public/.gitkeep src/components/.gitkeep src/features/.gitkeep \
  src/hooks/.gitkeep src/lib/.gitkeep src/server/.gitkeep src/types/.gitkeep \
  tests/unit/.gitkeep tests/e2e/.gitkeep
git commit -m "docs: document project baseline" -- \
  README.md public/.gitkeep src/components/.gitkeep src/features/.gitkeep \
  src/hooks/.gitkeep src/lib/.gitkeep src/server/.gitkeep src/types/.gitkeep \
  tests/unit/.gitkeep tests/e2e/.gitkeep
```

Expected: the commit contains only the README and placeholder files; unrelated staged files remain untouched.
