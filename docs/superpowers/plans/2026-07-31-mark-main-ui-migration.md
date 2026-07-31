# mark 分支采用 main 视觉界面设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `mark` 迁移 `main` 的视觉与交互表达，同时保持认证、文本分析、六模块报告和历史功能不变。

**Architecture:** 新建品牌、导航、示例三个展示组件。首页客户端编排组件只管理示例到输入框的预填状态；报告内容组件不改数据接口，`ReportModule` 负责折叠和视觉容器。

**Tech Stack:** Next.js 16、React 19、TypeScript、Tailwind CSS 4、Vitest、React Testing Library、Playwright。

## Global Constraints

- 保留用户名密码注册、登录、退出和现有服务端会话。
- 保留仅文本提交、六模块报告、历史记录与所有分析内容。
- 示例只预填文本，不创建任务；不新增游客、手机号、演示密码、URL 输入或链接解析。
- 认证页无全局导航；已认证页面有品牌导航；所有新增控件必须可键盘使用。

---

## File structure

- Create `src/components/brand/logo-mark.tsx`: 双圆交叠 Logo。
- Create `src/components/navigation/app-navigation.tsx`: 导航、账户菜单和退出确认。
- Create `src/components/analysis/inspiration-examples.tsx`: 三个文本预填示例。
- Create `src/features/analysis/components/home-analysis-workspace.tsx`: 连接示例和输入表单的客户端状态。
- Modify `src/app/globals.css`, `src/app/layout.tsx`, `src/app/(auth)/layout.tsx`: `main` 的 token、字体和认证卡片。
- Modify `src/app/page.tsx`, `src/app/history/page.tsx`, `src/features/analysis/components/analysis-workspace.tsx`: 页面 shell。
- Modify `src/features/auth/components/auth-form.tsx`, `src/features/analysis/components/analysis-form.tsx`, `src/features/analysis/components/report-module.tsx`, `src/features/analysis/components/{confidence-meter,traceability-badge,risks-module,perspectives-module,history-list}.tsx`: 表单、报告和历史 UI。
- Modify `tests/unit/app/home.test.tsx`, `tests/unit/features/analysis/{analysis-workspace,history-list,report-modules}.test.tsx`; create `tests/unit/features/analysis/home-analysis-workspace.test.tsx`; modify `tests/e2e/accessibility.spec.ts`.

### Task 1: Shared visual foundation

**Files:** Create `src/components/brand/logo-mark.tsx`; modify `src/app/globals.css`, `src/app/layout.tsx`, `tests/unit/app/home.test.tsx`.

**Interfaces:** Produces `LogoMark({ size?: number })`; CSS variables `--color-paper`, `--color-primary`, `--color-secondary`, `--color-ink`, and `animate-rise`.

- [ ] **Step 1: Write a failing branding test**

```tsx
it("shows the shared two-perspective brand mark", async () => {
  render(await Home());
  expect(screen.getByLabelText("第二视角")).toBeInTheDocument();
});
```

- [ ] **Step 2: Verify RED**

Run `pnpm test:unit -- tests/unit/app/home.test.tsx`. Expected: FAIL because the brand mark is absent.

- [ ] **Step 3: Implement the minimal foundation**

```tsx
export function LogoMark({ size = 28 }: { size?: number }) {
  return <svg aria-label="第二视角" width={size} height={size} viewBox="0 0 32 32">
    <circle cx="13" cy="16" r="10.5" fill="var(--color-primary)" opacity="0.9" />
    <circle cx="19" cy="16" r="10.5" fill="var(--color-secondary)" opacity="0.75" />
    <circle cx="16" cy="16" r="3.2" fill="var(--color-paper)" />
  </svg>;
}
```

Copy the paper/ink/indigo/teal/caution/stance/risk palette and rise/shake animations from `main`; load Space Grotesk, Inter and IBM Plex Mono in the root layout.

- [ ] **Step 4: Verify GREEN and commit**

Run `pnpm test:unit -- tests/unit/app/home.test.tsx`. Expected: PASS.

```bash
git add src/app/globals.css src/app/layout.tsx src/components/brand/logo-mark.tsx tests/unit/app/home.test.tsx
git commit -m "feat: add second perspective visual foundation"
```

### Task 2: Branded navigation and authentication surface

**Files:** Create `src/components/navigation/app-navigation.tsx`; modify `src/app/(auth)/layout.tsx`, `src/app/(auth)/login/page.tsx`, `src/app/(auth)/register/page.tsx`, `src/features/auth/components/auth-form.tsx`, `tests/unit/app/home.test.tsx`.

**Interfaces:** `AppNavigation({ username }: { username: string })` consumes the username and submits the existing `/api/auth/logout` route.

- [ ] **Step 1: Write a failing navigation test**

```tsx
it("shows branded navigation for an authenticated reader", async () => {
  render(await Home());
  expect(screen.getByRole("link", { name: "首页" })).toHaveAttribute("href", "/");
  expect(screen.getByRole("link", { name: "历史记录" })).toHaveAttribute("href", "/history");
  await userEvent.click(screen.getByRole("button", { name: "打开账户菜单" }));
  expect(screen.getByText("tester")).toBeInTheDocument();
});
```

- [ ] **Step 2: Verify RED**

Run `pnpm test:unit -- tests/unit/app/home.test.tsx`. Expected: FAIL because the navigation is absent.

- [ ] **Step 3: Implement navigation and auth card**

Use `LogoMark`, home/history links, an `aria-expanded` account menu and a confirmation dialog before logout form submission. Restyle the auth layout as the centered two-color card from `main`, but retain username/password fields and all existing authentication routes.

- [ ] **Step 4: Verify GREEN and commit**

Run `pnpm test:unit -- tests/unit/app/home.test.tsx`. Expected: PASS.

```bash
git add src/components/navigation src/app/'(auth)' src/features/auth/components/auth-form.tsx tests/unit/app/home.test.tsx
git commit -m "feat: add branded navigation and auth surfaces"
```

### Task 3: Homepage examples with controlled form input

**Files:** Create `src/components/analysis/inspiration-examples.tsx`, `src/features/analysis/components/home-analysis-workspace.tsx`, `tests/unit/features/analysis/home-analysis-workspace.test.tsx`; modify `src/app/page.tsx`, `src/features/analysis/components/analysis-form.tsx`.

**Interfaces:** `AnalysisForm` accepts optional `content` and `onContentChange(value)` while retaining its submission behavior. `InspirationExamples` accepts `onChoose(content)`. `HomeAnalysisWorkspace` owns content state.

- [ ] **Step 1: Write a failing prefill test**

```tsx
it("prefills a text example without submitting", async () => {
  const user = userEvent.setup();
  render(<HomeAnalysisWorkspace />);
  await user.click(screen.getByRole("button", { name: /35岁转行/ }));
  expect(screen.getByLabelText("想分析的内容")).toHaveValue("35岁转行，是冒险还是理性选择？");
  expect(screen.queryByText("正在提交…")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Verify RED**

Run `pnpm test:unit -- tests/unit/features/analysis/home-analysis-workspace.test.tsx`. Expected: FAIL because the component is absent.

- [ ] **Step 3: Implement the composition**

Create exactly three semantic example buttons—职场、消费、教育—each showing first and second views. Clicking writes its title into the controlled text box and never calls the submit API. Render the workspace below the existing product promise and navigation.

- [ ] **Step 4: Verify GREEN and commit**

Run `pnpm test:unit -- tests/unit/features/analysis/home-analysis-workspace.test.tsx`. Expected: PASS.

```bash
git add src/components/analysis/inspiration-examples.tsx src/features/analysis/components/home-analysis-workspace.tsx src/app/page.tsx src/features/analysis/components/analysis-form.tsx tests/unit/features/analysis/home-analysis-workspace.test.tsx
git commit -m "feat: add branded analysis homepage examples"
```

### Task 4: Collapsible report cards and semantic visual hierarchy

**Files:** Modify `src/features/analysis/components/analysis-workspace.tsx`, `src/features/analysis/components/report-module.tsx`, `src/features/analysis/components/{confidence-meter,traceability-badge,risks-module,perspectives-module}.tsx`, `tests/unit/features/analysis/{analysis-workspace,report-modules}.test.tsx`.

**Interfaces:** `ReportModule` retains `id`, `moduleType`, `title`, `status`, `children`, `onRetry`; it owns collapse state and exposes a heading button with `aria-expanded` and `aria-controls`.

- [ ] **Step 1: Write a failing collapse test**

```tsx
it("collapses and reopens a completed module", async () => {
  const user = userEvent.setup();
  render(<ReportModule id="overview" moduleType="overview" title="速览" status="completed"><p>核心主张内容</p></ReportModule>);
  const toggle = screen.getByRole("button", { name: "速览" });
  await user.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText("核心主张内容")).not.toBeInTheDocument();
  await user.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
});
```

- [ ] **Step 2: Verify RED**

Run `pnpm test:unit -- tests/unit/features/analysis/report-modules.test.tsx`. Expected: FAIL because the heading is not a toggle.

- [ ] **Step 3: Implement cards without changing report data**

Use paper rounded cards and full-width heading buttons. Keep status and retry controls. Render AppNavigation in the report shell. Accent overview/argument/reflection in indigo, perspectives in teal, risks in caution, and sources neutral; retain textual labels for every color tag.

- [ ] **Step 4: Verify GREEN and commit**

Run `pnpm test:unit -- tests/unit/features/analysis/report-modules.test.tsx tests/unit/features/analysis/analysis-workspace.test.tsx`. Expected: PASS.

```bash
git add src/features/analysis/components tests/unit/features/analysis/report-modules.test.tsx tests/unit/features/analysis/analysis-workspace.test.tsx
git commit -m "feat: style report modules as collapsible cards"
```

### Task 5: Shared history shell and end-to-end verification

**Files:** Modify `src/app/history/page.tsx`, `src/features/analysis/components/history-list.tsx`, `tests/unit/features/analysis/history-list.test.tsx`, `tests/e2e/accessibility.spec.ts`.

**Interfaces:** `HistoryList({ items })` and report link destinations remain unchanged. HistoryPage passes its authenticated username to AppNavigation.

- [ ] **Step 1: Write failing shared-shell tests**

```tsx
it("keeps history within shared navigation", async () => {
  render(await HistoryPage());
  expect(screen.getByRole("link", { name: "首页" })).toHaveAttribute("href", "/");
  expect(screen.getByRole("link", { name: "历史记录" })).toHaveAttribute("href", "/history");
});
```

Add these browser assertions after opening a report:

```tsx
await expect(page.getByRole("link", { name: "首页" })).toBeVisible();
await page.getByRole("button", { name: "速览" }).click();
await expect(page.getByRole("button", { name: "速览" })).toHaveAttribute("aria-expanded", "false");
```

- [ ] **Step 2: Verify RED**

Run `pnpm test:unit -- tests/unit/features/analysis/history-list.test.tsx`. Expected: FAIL because history has no shared navigation.

- [ ] **Step 3: Implement the history surface and any required accessible names**

Replace the local header with AppNavigation. Restyle list and empty state as paper cards; preserve item status, time, preview, completion count, ordering and links. Ensure the report toggle, examples and account menu have stable accessible names; do not change product behavior.

- [ ] **Step 4: Verify GREEN and full suite**

Run `pnpm test:unit -- tests/unit/app/home.test.tsx tests/unit/features/analysis/home-analysis-workspace.test.tsx tests/unit/features/analysis/analysis-workspace.test.tsx tests/unit/features/analysis/history-list.test.tsx tests/unit/features/analysis/report-modules.test.tsx && pnpm test:e2e -- tests/e2e/accessibility.spec.ts && pnpm typecheck && pnpm lint`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/history/page.tsx src/features/analysis/components/history-list.tsx tests/unit/features/analysis/history-list.test.tsx tests/e2e/accessibility.spec.ts
git commit -m "feat: align history with branded application shell"
```
