# 初始化数据库注释设计

## 目标

为 `drizzle/0000_mvp_baseline.sql` 的全部表和字段补充中文 PostgreSQL 注释，便于在云数据库控制台和数据库客户端中理解数据模型。

## 实现

在现有迁移文件末尾追加 `COMMENT ON TABLE` 与 `COMMENT ON COLUMN` 语句。注释依据 `src/server/db/schema/` 中的字段语义编写，覆盖认证、会话、限流、分析任务、专家执行、报告、来源及事件记录。

## 范围与边界

- 不变更表、字段、索引、约束或默认值。
- 不新增迁移文件；该初始化迁移尚未在任何环境执行。
- 不修改 Drizzle schema；注释仅写入 PostgreSQL 元数据。

## 验收

- SQL 可由 PostgreSQL 解析执行。
- 每张表和每个字段都有准确的中文注释。
- `pnpm db:migrate` 可正常应用迁移。
