# M2 边聊边拆与报告修订 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户可质疑报告条目，获得可恢复的 Agent 回应与可追溯的报告修订。

**Architecture:** 在现有分析报告的 job 级事件流上增加持久化会话与修订记录。质疑请求先保存，再由独立修订执行器处理；成功时用报告版本 CAS 原子保存回复、模块更新、修订记录和事件，前端以快照加现有 SSE/轮询恢复。

**Tech Stack:** Next.js App Router、React、TypeScript、Zod、Drizzle/PostgreSQL、LogTape、Vitest、React Testing Library、Playwright。

## Global Constraints

- 使用 `ReportItemTarget = { moduleType, section, itemId }`，不使用 DOM id 或数组下标。
- 用户身份只从会话取得；所有读取和写入均校验资源归属，并对写请求调用 `assertTrustedMutation()`。
- 消息内容、完整材料、密码与会话令牌不得记录到日志或产品事件。
- 已完成的基线报告持续可读；修订失败只影响该次质疑，不能改变基线任务状态。
- 复用 `analysis_events`、`useAnalysisStream` 和 shadcn/ui，不新增依赖。

## Ownership and Integration

| Task | Owned files/modules | Shared contract |
| --- | --- | --- |
| 1 | migration、DB schema、analysis contracts/repository、repository tests | snapshot、target、message、revision 数据类型 |
| 2 | conversation server/agents/dispatcher/API、container、observability | Task 1 的 repository 与 domain contracts |
| 3 | conversation UI、report item actions、stream hook、component tests | Task 1 snapshot；Task 2 API |
| 4 | Playwright 场景 C | 已集成的公开 UI/API |

任务 1 必须先完成；任务 2 和 3 都依赖其契约，Task 4 最后执行。

---

### Task 1: 持久化会话、修订与快照契约

**Files:**
- Create: `drizzle/0001_m2_conversation_revisions.sql`
- Modify: `src/server/db/schema/analysis.ts`
- Modify: `src/features/analysis/domain/contracts.ts`
- Modify: `src/features/analysis/server/analysis-repository.ts`
- Modify: `src/features/analysis/server/postgres-analysis-repository.ts`
- Test: `tests/integration/features/analysis/analysis-repository.test.ts`
- Test: `tests/unit/features/analysis/contracts.test.ts`

**Interfaces:**
- Produces `ReportItemTarget`, `ConversationMessage`, `ReportRevision`, and M2 fields on `AnalysisSnapshot`.
- Produces repository operations to create idempotent challenges, load owned messages/revisions, and atomically complete or recover a revision under report-version CAS.

- [ ] **Step 1: Write failing domain and repository tests**

Add tests proving risk IDs are required, a target is validated, another user cannot read a saved message, the same idempotency key returns one message, and an outdated report version cannot overwrite a newer revision.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `pnpm vitest run tests/unit/features/analysis/contracts.test.ts tests/integration/features/analysis/analysis-repository.test.ts`

Expected: FAIL because M2 contracts and repository methods do not exist.

- [ ] **Step 3: Add migration and schema**

Create `conversation_messages` with `report_id`, `user_id`, `role`, `target`, `content`, `status`, nullable `idempotency_key`, timestamps, and a unique `(report_id, idempotency_key)` constraint. Create `report_revisions` with triggering message, version range, structured changes, status, and timestamps. Add ownership/index/foreign-key constraints and Chinese table/column comments.

- [ ] **Step 4: Add contracts and repository transactions**

Define the stable target and revision change schemas. Extend the owned snapshot with `reportId`, `currentVersion`, ordered messages, and revisions. Insert the user message before dispatch; complete a revision in one transaction with the Agent message, CAS-protected report version/module update, revision record, and `analysis_events` entry. Mark failed work recoverable without modifying the report.

- [ ] **Step 5: Run focused verification**

Run: `pnpm vitest run tests/unit/features/analysis/contracts.test.ts tests/integration/features/analysis/analysis-repository.test.ts && pnpm typecheck && pnpm lint`

Expected: all pass.

### Task 2: 修订应用用例、Agent、API 与埋点

**Files:**
- Create: `src/features/conversation/server/submit-challenge.ts`
- Create: `src/features/conversation/server/revision-orchestrator.ts`
- Create: `src/features/conversation/domain/contracts.ts`
- Create: `src/app/api/analyses/[jobId]/challenges/route.ts`
- Modify: `src/server/agents/expert-suite.ts`
- Modify: `src/server/agents/ai-expert-suite.ts`
- Modify: `src/server/agents/fake-expert-suite.ts`
- Modify: `src/server/container.ts`
- Modify: `src/server/observability/product-events.ts`
- Modify: `src/app/api/product-events/route.ts`
- Test: `tests/integration/features/conversation/revision-orchestrator.test.ts`
- Test: `tests/integration/app/api/challenge-access.test.ts`

**Interfaces:**
- Consumes Task 1 challenge persistence and snapshot contracts.
- Produces `POST /api/analyses/:jobId/challenges`, durable revision processing, and two M2 product events.

- [ ] **Step 1: Write failing use-case and API tests**

Cover successful risk challenge, repeated request idempotency, foreign-user rejection, untrusted-origin rejection, Agent failure preserving the report, and `report_item_challenged`/`report_revised` event keys.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm vitest run tests/integration/features/conversation/revision-orchestrator.test.ts tests/integration/app/api/challenge-access.test.ts`

Expected: FAIL because the challenge endpoint and revision use case do not exist.

- [ ] **Step 3: Implement the smallest durable flow**

Validate the request with Zod, `getCurrentUser()`, ownership and `assertTrustedMutation()`. Persist the message, dispatch the revision, and return its ID/status. Give the expert suite a structured targeted-review operation whose input includes material, target, current module, persisted conversation context, and optional new sources; its output contains response text and an optional module replacement with a reason and source IDs. Record only IDs/statuses in LogTape.

- [ ] **Step 4: Record M2 product events**

Extend the server-owned event union and route validation. Use message ID for `report_item_challenged` and revision ID for `report_revised` so each event remains idempotent.

- [ ] **Step 5: Run focused verification**

Run: `pnpm vitest run tests/integration/features/conversation/revision-orchestrator.test.ts tests/integration/app/api/challenge-access.test.ts && pnpm typecheck && pnpm lint`

Expected: all pass.

### Task 3: 报告内质疑、对话和修订展示

**Files:**
- Create: `src/features/conversation/components/conversation-panel.tsx`
- Create: `src/features/conversation/components/revision-history.tsx`
- Modify: `src/features/analysis/components/report-module.tsx`
- Modify: `src/features/analysis/components/risks-module.tsx`
- Modify: `src/features/analysis/components/sources-module.tsx`
- Modify: `src/features/analysis/components/analysis-workspace.tsx`
- Modify: `src/features/analysis/hooks/use-analysis-stream.ts`
- Test: `tests/unit/features/conversation/conversation-panel.test.tsx`
- Test: `tests/unit/features/analysis/analysis-workspace.test.tsx`

**Interfaces:**
- Consumes Task 1 snapshot records and Task 2 challenge endpoint.
- Produces a keyboard-accessible, page-local user flow from report item to persisted challenge and visible revision history.

- [ ] **Step 1: Write failing component tests**

Render a completed report, activate a button named `质疑：认知风险`, submit a question, and assert the targeted request, pending status, and no focus stealing after an updated snapshot. Assert revision history renders location, reason and new evidence text.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm vitest run tests/unit/features/conversation/conversation-panel.test.tsx tests/unit/features/analysis/analysis-workspace.test.tsx`

Expected: FAIL because report actions and the panel do not exist.

- [ ] **Step 3: Implement UI with existing components**

Add semantic challenge buttons at the shared statement renderer, sources relation cards and risk cards. Add a page-local conversation panel with a selected target, `Textarea`, `Button`, message state and retry. Render a compact revision history that links to a focusable report anchor. Use one polite status region and keep focus/scroll unchanged on remote updates.

- [ ] **Step 4: Extend stream recovery**

Refresh the complete M2 snapshot for conversation/revision events. Keep SSE or polling active while a message is queued/running/recoverable, even when the baseline job is complete; merge records by stable ID and event cursor.

- [ ] **Step 5: Run focused verification**

Run: `pnpm vitest run tests/unit/features/conversation/conversation-panel.test.tsx tests/unit/features/analysis/analysis-workspace.test.tsx && pnpm typecheck && pnpm lint`

Expected: all pass.

### Task 4: 产品场景 C 的端到端验收

**Files:**
- Create: `tests/e2e/conversation-revision.spec.ts`
- Modify: `tests/e2e/fixtures.ts`

**Interfaces:**
- Consumes the public report page, challenge endpoint, persisted snapshot, and fake Agent adapter.
- Produces regression coverage for product验收场景 C.

- [ ] **Step 1: Write the failing scenario**

Create a report with a cognitive-risk entry, challenge it through the accessible action, wait for the Agent response and revision record, reload the page, and assert the same response, revision location, reason and new evidence remain visible.

- [ ] **Step 2: Run the scenario and verify failure**

Run: `pnpm exec playwright test tests/e2e/conversation-revision.spec.ts`

Expected: FAIL before the M2 UI/API is integrated.

- [ ] **Step 3: Complete any fixture wiring required by the public flow**

Keep the fixture limited to existing test database/auth helpers and fake Agent adapter; do not mock the M2 route in the browser.

- [ ] **Step 4: Run final verification**

Run:

```bash
pnpm vitest run tests/unit/features/analysis tests/unit/features/conversation tests/integration/features/analysis tests/integration/features/conversation tests/integration/app/api
pnpm typecheck
pnpm lint
pnpm exec playwright test tests/e2e/conversation-revision.spec.ts
pnpm build
```

Expected: all M2-targeted checks pass. If unrelated legacy tests fail, record their file, cause and separation from M2.

- [ ] **Step 5: Commit**

Commit each completed task with scoped messages: `feat: persist conversation revisions`, `feat: process report challenges`, `feat: add report conversation UI`, and `test: cover report challenge recovery`.
