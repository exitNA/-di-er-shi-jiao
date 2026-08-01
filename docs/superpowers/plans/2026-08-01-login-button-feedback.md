# 登录按钮悬停反馈 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让导航中的登录按钮提供明确的鼠标悬停与可点击反馈。

**Architecture:** 认证弹窗仍由 `AuthDialog` 管理。仅将其原生触发按钮替换为项目已有的 shadcn/ui `Button`，使其继承默认 hover、过渡和焦点样式，并保留胶囊外观。

**Tech Stack:** Next.js、React、TypeScript、shadcn/ui、Vitest、React Testing Library。

## Global Constraints

- 只使用已有的 shadcn/ui `Button`，不新增依赖。
- 不修改认证状态、诊断事件或弹窗内容。
- 保持可访问名称“登录”与键盘焦点可用。

---

### Task 1: 使用共享按钮组件作为登录触发器

**Files:**
- Modify: `src/features/auth/components/auth-dialog.tsx`
- Test: `tests/unit/features/auth/auth-dialog.test.tsx`

**Interfaces:**
- Consumes: `Button` from `@/components/ui/button` with standard button props.
- Produces: A button named “登录” which opens the existing controlled `Dialog` on click.

- [x] **Step 1: Write the failing test**

Add this assertion after rendering `AuthDialog`:

```tsx
expect(screen.getByRole("button", { name: "登录" })).toHaveClass("cursor-pointer");
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/features/auth/auth-dialog.test.tsx`

Expected: FAIL because the native trigger does not have the `cursor-pointer` class.

- [x] **Step 3: Write minimal implementation**

Import `Button` from `@/components/ui/button`, then replace the trigger element with:

```tsx
<Button
  type="button"
  size="sm"
  className="cursor-pointer rounded-full"
  onClick={() => {
    setOpen(true);
    recordEvent("login_clicked");
  }}
>
  登录
</Button>
```

- [x] **Step 4: Run tests and static checks**

Run `pnpm vitest run tests/unit/features/auth/auth-dialog.test.tsx`, `pnpm typecheck`, and `pnpm lint`; all must pass.

- [x] **Step 5: Commit**

Commit the component, test, and this plan with message `fix: add login button hover feedback`.
