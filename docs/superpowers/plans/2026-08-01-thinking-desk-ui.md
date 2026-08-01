# Thinking Desk UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved Thinking Desk visual system to the home, report, history, and navigation surfaces without changing analysis behavior.

**Architecture:** Keep existing route and domain boundaries. Theme tokens and global accessibility/motion rules live in `globals.css`; each current page/component keeps its existing behavior while changing only markup classes and presentational copy.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, Vitest and React Testing Library.

## Global Constraints

- Reuse existing components and `lucide-react`; add no dependencies, routes, or data-model fields.
- Retain semantic controls, visible focus states, 320px responsiveness, and reduced-motion support.
- Preserve existing submit, stream, retry, history, authentication, and conversation behavior.

---

### Task 1: Install the Thinking Desk foundation

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Add the approved colors, typography, focus, and motion rules**

Use `--color-forest: #163A36`, `--color-mist: #DFF0EE`, `--color-paper: #F8F7F2`, `--color-apricot: #F4C99B`, `--color-ink: #24302D`, and `--color-border: #DCE1DA`; expose them to Tailwind and set a serif display stack.

- [ ] **Step 2: Verify static CSS and TypeScript**

Run: `pnpm lint:style && pnpm typecheck`

### Task 2: Restyle navigation and home input

**Files:**
- Modify: `src/components/navigation/app-navigation.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/features/analysis/components/analysis-form.tsx`
- Modify: `src/features/analysis/components/home-analysis-workspace.tsx`
- Test: `tests/unit/app/home.test.tsx`

- [ ] **Step 1: Write a failing test for the clarified primary action**

```tsx
expect(screen.getByRole("button", { name: "展开第二视角" })).toBeDisabled();
```

- [ ] **Step 2: Run the focused test and verify it fails because the action label is absent**

Run: `pnpm vitest run tests/unit/app/home.test.tsx`

- [ ] **Step 3: Implement the warm input card, navigation state, and prism example cards**

Keep the textarea ID, character count, submit handler, click-to-fill behavior, and disabled state. Change only presentation and use the action label from Step 1 for the non-compact form control.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `pnpm vitest run tests/unit/app/home.test.tsx`

### Task 3: Build the report analysis rail

**Files:**
- Modify: `src/features/analysis/components/analysis-workspace.tsx`
- Test: `tests/unit/features/analysis/analysis-workspace.test.tsx`

- [ ] **Step 1: Write a failing test asserting report progress remains visible**

```tsx
expect(screen.getByText("认知体检生成中，已完成 0 / 6 个模块")).toBeVisible();
```

- [ ] **Step 2: Run the focused test and verify it fails only if the existing status copy is changed**

Run: `pnpm vitest run tests/unit/features/analysis/analysis-workspace.test.tsx`

- [ ] **Step 3: Implement the report header, source preview, and single vertical module rail**

Do not alter module selection, retry callbacks, streaming, or the conversation/revision props. Make the lower work area responsive from two columns to one.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `pnpm vitest run tests/unit/features/analysis/analysis-workspace.test.tsx`

### Task 4: Restyle history as an archive

**Files:**
- Modify: `src/app/history/page.tsx`
- Modify: `src/features/analysis/components/history-list.tsx`
- Test: `tests/unit/features/analysis/history-list.test.tsx`

- [ ] **Step 1: Write a failing test for the archive continuation action**

```tsx
expect(screen.getByRole("link", { name: "继续查看" })).toHaveAttribute("href", "/analysis/job-1");
```

- [ ] **Step 2: Run the focused test and verify it fails because the old link label is used**

Run: `pnpm vitest run tests/unit/features/analysis/history-list.test.tsx`

- [ ] **Step 3: Implement archive styling and the clarified action wording**

Retain all status labels, timestamps, previews, links, and the no-history path.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `pnpm vitest run tests/unit/features/analysis/history-list.test.tsx`

### Task 5: Verify the complete redesign

**Files:**
- Modify: no production files expected

- [ ] **Step 1: Run validation and relevant unit tests**

Run: `pnpm validate && pnpm test:unit -- tests/unit/app/home.test.tsx tests/unit/features/analysis/analysis-workspace.test.tsx tests/unit/features/analysis/history-list.test.tsx`

- [ ] **Step 2: Run the browser test if the local browser environment is available**

Run: `pnpm test:e2e -- tests/e2e/accessibility.spec.ts`

- [ ] **Step 3: Review the diff for unintended behavior changes**

Run: `git diff --check && git diff -- src/app src/components/navigation src/features/analysis/components tests/unit`
