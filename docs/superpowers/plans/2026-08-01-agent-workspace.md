# Agent Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the analysis report with a resizable conversation-and-findings workspace.

**Architecture:** `AnalysisWorkspace` remains the stream owner. A client split layout composes the existing conversation flow with a new findings view sourced from the existing analysis modules.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, Vitest, React Testing Library.

## Global Constraints

- Reuse the current snapshot, stream hook, challenge API and report module payloads.
- Desktop defaults to a 38/62 split and is adjustable by pointer and keyboard.
- At narrow widths, show a single-column conversation/findings switcher.
- Do not use report or completion-count language in the new workspace.

---

### Task 1: Build the adjustable shell

**Files:**

- Create: `src/features/analysis/components/agent-workspace-layout.tsx`
- Test: `tests/unit/features/analysis/agent-workspace-layout.test.tsx`

- [ ] Write a failing test for a separator named `调整对话与发现区域宽度` with initial `aria-valuenow="38"` and an ArrowRight adjustment.
- [ ] Implement a React stateful grid layout with a native range separator, pointer drag support, desktop panes, and narrow-screen tabs.
- [ ] Run `pnpm vitest run tests/unit/features/analysis/agent-workspace-layout.test.tsx`.
- [ ] Commit `feat: add resizable agent workspace layout`.

### Task 2: Build current findings

**Files:**

- Create: `src/features/analysis/components/current-findings-panel.tsx`
- Test: `tests/unit/features/analysis/current-findings-panel.test.tsx`

- [ ] Write a failing test that clicks a core claim and asserts `onSelect({ moduleType: "overview", section: "coreClaims", itemId: "claim-1" })`.
- [ ] Render completed overview, argument, perspective, source, and risk payload entries as selectable result cards; render concise running states for unavailable data.
- [ ] Run `pnpm vitest run tests/unit/features/analysis/current-findings-panel.test.tsx`.
- [ ] Commit `feat: add interactive findings panel`.

### Task 3: Compose and preserve follow-up behavior

**Files:**

- Modify: `src/features/analysis/components/analysis-workspace.tsx`
- Modify: `src/features/conversation/components/conversation-panel.tsx`
- Test: `tests/unit/features/analysis/analysis-workspace.test.tsx`

- [ ] Update the workspace test to expect `与第二视角一起推理` and `当前发现`, and no `认知体检报告`.
- [ ] Replace report-card composition with the split shell, put conversation on the left and findings on the right, and keep existing stream refresh/retry calls.
- [ ] Select a finding to populate the existing conversation target context and preserve request failure/retry feedback.
- [ ] Run `pnpm vitest run tests/unit/features/analysis/analysis-workspace.test.tsx tests/unit/features/conversation/conversation-panel.test.tsx`.
- [ ] Commit `refactor: present analysis as agent workspace`.

### Task 4: Verify

- [ ] Run `pnpm vitest run tests/unit/features/analysis tests/unit/features/conversation`.
- [ ] Run `pnpm typecheck && pnpm lint:style && pnpm lint:build && git diff --check`.
- [ ] Manually test drag, keyboard adjustment, a selected finding, a follow-up submission, and narrow-screen tabs.
