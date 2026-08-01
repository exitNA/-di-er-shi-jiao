# Auth Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在当前页面通过弹窗完成登录与注册，并移除独立认证页体验。

**Architecture:** 新增客户端 `AuthDialog` 管理弹窗开关和登录/注册模式；`AuthForm` 接受成功回调而非强制跳转。导航仅渲染该组件，旧认证页重定向到首页。

**Tech Stack:** Next.js App Router、React、TypeScript、shadcn/ui Dialog、Vitest、React Testing Library。

## Global Constraints

- 复用 `src/components/ui/dialog.tsx`，不新增依赖。
- 保留 API 错误、加载状态、键盘关闭和焦点管理。
- 成功后关闭弹窗并刷新当前路由。

---

### Task 1: 认证弹窗组件

**Files:**
- Create: `src/features/auth/components/auth-dialog.tsx`
- Modify: `src/features/auth/components/auth-form.tsx`
- Test: `tests/unit/features/auth/auth-dialog.test.tsx`

**Interfaces:**
- Consumes: `AuthForm({ mode, onSuccess? })` 与 shadcn `Dialog`。
- Produces: `AuthDialog()`，渲染登录触发器及受控认证弹窗。

- [ ] **Step 1: 写失败测试**

```tsx
render(<AuthDialog />);
await user.click(screen.getByRole("button", { name: "登录" }));
expect(screen.getByRole("dialog")).toBeInTheDocument();
expect(screen.getByRole("heading", { name: "登录" })).toBeInTheDocument();
await user.click(screen.getByRole("button", { name: "创建账号" }));
expect(screen.getByRole("heading", { name: "创建账号" })).toBeInTheDocument();
```

- [ ] **Step 2: 验证失败**

Run: `pnpm vitest run tests/unit/features/auth/auth-dialog.test.tsx`

Expected: FAIL，因为 `AuthDialog` 尚不存在。

- [ ] **Step 3: 实现最小组件**

```tsx
export function AuthDialog() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const onSuccess = () => { setOpen(false); router.refresh(); };
  // DialogContent 内按 mode 渲染标题、AuthForm 和模式切换按钮。
}
```

`AuthForm` 增加可选 `onSuccess?: () => void`；成功时优先调用它，否则保留 `router.push("/")` 和 `router.refresh()`。

- [ ] **Step 4: 验证通过**

Run: `pnpm vitest run tests/unit/features/auth/auth-dialog.test.tsx`

Expected: PASS。

- [ ] **Step 5: 提交**

Run: `git add src/features/auth/components/auth-dialog.tsx src/features/auth/components/auth-form.tsx tests/unit/features/auth/auth-dialog.test.tsx && git commit -m "feat: add authentication dialog"`

### Task 2: 接入导航与淘汰独立页面

**Files:**
- Modify: `src/components/navigation/app-navigation.tsx`
- Modify: `src/app/(auth)/login/page.tsx`
- Modify: `src/app/(auth)/register/page.tsx`
- Modify: `tests/e2e/baseline-report.spec.ts`
- Modify: `tests/e2e/accessibility.spec.ts`
- Modify: `tests/e2e/history.spec.ts`
- Modify: `tests/e2e/ownership.spec.ts`
- Modify: `tests/e2e/recovery.spec.ts`
- Modify: `tests/e2e/search-degradation.spec.ts`

**Interfaces:**
- Consumes: `AuthDialog()`。
- Produces: 未登录导航通过弹窗认证；`/login` 和 `/register` 重定向到 `/`。

- [ ] **Step 1: 调整端到端注册帮助函数**

```ts
await page.goto("/");
await page.getByRole("button", { name: "登录" }).click();
await page.getByRole("button", { name: "创建账号" }).click();
await page.getByLabel("用户名").fill(username);
await page.getByLabel("密码").fill("a secure baseline password");
await page.getByRole("button", { name: "创建账号" }).last().click();
```

- [ ] **Step 2: 替换导航链接并重定向旧页**

```tsx
{username ? <AccountMenu /> : <AuthDialog />}
```

```tsx
import { redirect } from "next/navigation";
export default function LoginPage() { redirect("/"); }
```

注册页使用相同重定向。

- [ ] **Step 3: 验证关键路径**

Run: `pnpm typecheck && pnpm test:unit && pnpm test:e2e -- --grep "accessibility"`

Expected: 认证弹窗可访问、类型检查通过；若既有无关测试失败，记录其失败原因。

- [ ] **Step 4: 提交**

Run: `git add src/components/navigation/app-navigation.tsx 'src/app/(auth)/login/page.tsx' 'src/app/(auth)/register/page.tsx' tests/e2e && git commit -m "feat: use auth dialog from navigation"`
