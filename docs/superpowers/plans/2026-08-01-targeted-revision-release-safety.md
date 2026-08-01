# Targeted Revision Release Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent targeted reviews from persisting untrusted sources or changing any report content outside the challenged target.

**Architecture:** Keep the current full-module Agent response for this release, but validate it twice: the Agent output schema only accepts already-persisted source IDs, and a shared domain projection compares current/replacement modules after removing the single challenged item. The orchestrator rejects invalid output early; the Postgres repository rechecks the same target scope against the locked current module and treats `report_sources` as the authoritative evidence set.

**Tech Stack:** TypeScript 6, Zod, Drizzle ORM/PostgreSQL, Vitest.

## Global Constraints

- Use pnpm only.
- Preserve revision leases, fencing, timeout, report/module CAS and durable source catalog behavior.
- Do not add search-candidate persistence, retry APIs, UI changes or new dependencies.
- Follow strict TDD: observe each new regression test fail before editing production code.
- Work sequentially in the shared main workspace because repository AGENTS.md overrides subagent execution.

---

### Task 1: Restrict targeted-review sources to persisted report sources

**Files:**
- Modify: `src/features/conversation/domain/contracts.ts`
- Modify: `src/features/analysis/server/postgres-analysis-repository.ts`
- Test: `tests/unit/features/conversation/contracts.test.ts`
- Test: `tests/integration/features/analysis/analysis-repository.test.ts`

**Interfaces:**
- Consumes: `targetedReviewSchema(moduleType, allowedEvidenceSourceIds)` and `CompleteRevision.module`.
- Produces: Agent and repository validation where evidence IDs and sources-module IDs must already exist in `report_sources`.

- [x] **Step 1: Write the failing contract test**

Add an assertion that a sources replacement containing `source-new` fails when `allowedEvidenceSourceIds` is empty, even when full metadata is present in `replacement.module.sources`.

```ts
expect(schema.safeParse(outputWithSourceNew).success).toBe(false);
```

- [x] **Step 2: Write the failing repository test**

Submit a sources replacement containing a new source and assert that completion is rejected and neither the module nor `report_sources` changes.

```ts
expect(result).toEqual({ completed: false });
expect(await db.select().from(reportSources)).toEqual([expect.objectContaining({ sourceKey: "source-old" })]);
```

- [x] **Step 3: Run RED**

Run:

```bash
TEST_DATABASE_URL=postgres://app:app@127.0.0.1:54329/second_perspective_test pnpm vitest run tests/unit/features/conversation/contracts.test.ts tests/integration/features/analysis/analysis-repository.test.ts -t "sources replacement" --maxWorkers=1
```

Expected: both tests fail because the current contract/repository trusts replacement source IDs.

- [x] **Step 4: Implement the minimal restriction**

Remove replacement-provided IDs from both allowlists. For sources modules, require every `payload.sources[].id` to be present in the locked `report_sources` rows before report CAS or catalog sync.

```ts
const persistedSourceIds = new Set(persistedSources.map(({ sourceKey }) => sourceKey));
if (!evidenceSourceIds.every((sourceId) => persistedSourceIds.has(sourceId))) return { completed: false };
if (input.module.moduleType === "sources"
  && !input.module.payload.sources.every((source) => persistedSourceIds.has(source.id))) {
  return { completed: false };
}
```

- [x] **Step 5: Run GREEN**

Run the Task 1 command again and require all selected tests to pass.

### Task 2: Enforce target-scoped full-module replacements

**Files:**
- Modify: `src/features/analysis/domain/contracts.ts`
- Modify: `src/features/conversation/server/revision-orchestrator.ts`
- Modify: `src/features/analysis/server/postgres-analysis-repository.ts`
- Test: `tests/unit/features/analysis/contracts.test.ts`
- Test: `tests/integration/features/conversation/revision-orchestrator.test.ts`
- Test: `tests/integration/features/analysis/analysis-repository.test.ts`

**Interfaces:**
- Produces: `isTargetScopedModuleReplacement(currentModule, replacementModule, target): boolean`.
- Consumes: schema-parsed module payloads and the durable `ReportItemTarget`.

- [x] **Step 1: Write failing domain tests for outside-target changes**

Use a risks module with `risk-1` and `risk-2`: modifying/removing only `risk-1` is accepted; modifying `risk-2`, adding a third risk, or duplicating `risk-1` is rejected. Add a sources relation/gap case proving source metadata is outside either target.

```ts
expect(isTargetScopedModuleReplacement(current, onlyRiskOneChanged, target)).toBe(true);
expect(isTargetScopedModuleReplacement(current, riskTwoChanged, target)).toBe(false);
```

- [x] **Step 2: Run domain RED**

Run:

```bash
pnpm vitest run tests/unit/features/analysis/contracts.test.ts -t "target-scoped" --maxWorkers=1
```

Expected: fail because `isTargetScopedModuleReplacement` does not exist.

- [x] **Step 3: Implement the shared projection validator**

Parse both modules with the target module schema, remove at most one matching target from the target section, and deep-compare the remaining module. Reject invalid sections and duplicate target matches.

```ts
export function isTargetScopedModuleReplacement(
  current: BaselineDraft[ReportModuleType],
  replacement: BaselineDraft[ReportModuleType],
  target: ReportItemTarget,
): boolean;
```

- [x] **Step 4: Run domain GREEN**

Run the Task 2 domain command again and require all selected tests to pass.

- [x] **Step 5: Write failing orchestrator and repository tests**

Return a replacement that removes the challenged risk while also rewriting a sibling risk. Assert the orchestrator becomes recoverable and the repository rejects a direct completion; assert report version, module version and revision history are unchanged.

```ts
expect(result).toMatchObject({ ok: true, status: "recoverable" });
expect(snapshot).toMatchObject({ currentVersion: 0, revisions: [] });
```

- [x] **Step 6: Run server RED**

Run:

```bash
TEST_DATABASE_URL=postgres://app:app@127.0.0.1:54329/second_perspective_test pnpm vitest run tests/integration/features/conversation/revision-orchestrator.test.ts tests/integration/features/analysis/analysis-repository.test.ts -t "outside the challenged target" --maxWorkers=1
```

Expected: both paths incorrectly complete today.

- [x] **Step 7: Add orchestrator and locked-repository validation**

Validate before calling `completeRevision`, then load/lock the current report module by expected version inside `completeRevision` and re-run the shared validator before any report/source/module mutation. Keep the existing single `changes` entry, whose target now covers every permitted module difference.

- [x] **Step 8: Run server GREEN**

Run the Task 2 server command again and require all selected tests to pass.

### Task 3: Verify and report

**Files:**
- Modify: `.superpowers/sdd/2026-08-01-m2-conversation-revisions/final-backend-fix-report.md`

**Interfaces:**
- Consumes: Task 1 and Task 2 results.
- Produces: release-review evidence and a single backend commit.

- [x] **Step 1: Run focused regression**

Run all analysis/conversation contract, Agent, repository, orchestrator and route tests affected by targeted revision.

- [x] **Step 2: Run static and production verification**

```bash
pnpm typecheck
pnpm lint
pnpm build
```

- [x] **Step 3: Append the implementation report**

Record the source allowlist, target projection semantics, RED/GREEN evidence, exact commands and results.

- [x] **Step 4: Audit and commit only owned files**

```bash
git diff --check
git commit -m "fix: constrain targeted report revisions"
```
