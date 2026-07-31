# Schema Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为初始化 PostgreSQL 迁移中的全部表和字段写入准确的中文注释。

**Architecture:** 在 `0000_mvp_baseline.sql` 的 DDL 和约束定义后追加 PostgreSQL `COMMENT ON` 语句。注释只影响数据库元数据，不改变迁移产生的结构、约束或数据。

**Tech Stack:** PostgreSQL、Drizzle Kit、pnpm。

## Global Constraints

- 仅修改尚未执行的 `drizzle/0000_mvp_baseline.sql`。
- 为 12 张表及其全部字段提供中文注释。
- 不修改 `src/server/db/schema/`、不新增依赖、不改变 DDL。

---

### Task 1: 为初始化迁移追加数据库注释

**Files:**
- Modify: `drizzle/0000_mvp_baseline.sql`

**Interfaces:**
- Consumes: `src/server/db/schema/analysis.ts` 和 `src/server/db/schema/auth.ts` 定义的表及字段语义。
- Produces: PostgreSQL 可执行的 `COMMENT ON TABLE` 和 `COMMENT ON COLUMN` 元数据声明。

- [x] **Step 1: 清点迁移覆盖的对象**

确认迁移中的 12 张表为 `analysis_events`、`analysis_jobs`、`analysis_materials`、`expert_runs`、`product_events`、`report_modules`、`report_sources`、`reports`、`auth_rate_limits`、`password_credentials`、`sessions` 和 `users`；逐项比对 schema 的字段名。

- [x] **Step 2: 追加最小实现**

在迁移文件末尾追加以下形式的 SQL，并为每张表及每个字段分别给出业务含义：

```sql
COMMENT ON TABLE "analysis_jobs" IS '分析任务';
COMMENT ON COLUMN "analysis_jobs"."id" IS '分析任务唯一标识';
COMMENT ON COLUMN "analysis_jobs"."status" IS '任务当前状态';
```

- [x] **Step 3: 静态验证**

运行：

```bash
rg -c '^COMMENT ON TABLE' drizzle/0000_mvp_baseline.sql
git diff --check -- drizzle/0000_mvp_baseline.sql
```

预期：表注释计数为 `12`，且 diff 无空白错误。

- [x] **Step 4: 在本地 PostgreSQL 验证迁移**

运行：

```bash
pnpm db:up
DATABASE_URL=postgres://app:app@127.0.0.1:54329/second_perspective pnpm db:migrate
psql 'postgres://app:app@127.0.0.1:54329/second_perspective' -Atqc "SELECT obj_description('analysis_jobs'::regclass), col_description('analysis_jobs'::regclass, 1);"
```

预期：迁移成功，查询返回 `分析任务|分析任务唯一标识`。

- [x] **Step 5: 提交迁移**

```bash
git add drizzle/0000_mvp_baseline.sql docs/superpowers/plans/2026-07-31-schema-comments.md
git commit -m "docs: annotate initial database schema"
```
