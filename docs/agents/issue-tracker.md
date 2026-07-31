# 问题跟踪器：GitHub

本仓库的 Issue 和 PRD 均记录在 GitHub Issues 中。所有操作使用 `gh` CLI 完成。

## 约定

- **创建 Issue**：`gh issue create --title "..." --body "..."`。多行正文使用 heredoc。
- **读取 Issue**：`gh issue view <number> --comments`，使用 `jq` 过滤评论，并同时获取标签。
- **列出 Issue**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，并根据需要添加 `--label` 和 `--state` 过滤条件。
- **评论 Issue**：`gh issue comment <number> --body "..."`
- **添加或移除标签**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **关闭 Issue**：`gh issue close <number> --comment "..."`

从 `git remote -v` 推断仓库；在仓库克隆目录中运行时，`gh` 会自动完成此操作。

## 是否将 Pull Request 作为分诊入口

**PRs as a request surface: no.** _（如果本仓库将外部 PR 视为功能请求，可改为 `yes`；`/triage` 会读取此标志。）_

设置为 `yes` 后，PR 将使用与 Issue 相同的标签和状态，并通过对应的 `gh pr` 命令操作：

- **读取 PR**：使用 `gh pr view <number> --comments`，并通过 `gh pr diff <number>` 查看差异。
- **列出待分诊的外部 PR**：运行 `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`，仅保留 `authorAssociation` 为 `CONTRIBUTOR`、`FIRST_TIME_CONTRIBUTOR` 或 `NONE` 的 PR，排除 `OWNER`、`MEMBER` 和 `COLLABORATOR`。
- **评论、添加标签或关闭**：使用 `gh pr comment`、`gh pr edit --add-label` / `--remove-label`、`gh pr close`。

GitHub 的 Issue 和 PR 共用同一个编号空间，因此 `#42` 可能指向任意一种对象。先运行 `gh pr view 42`，失败后再运行 `gh issue view 42`。

## 当技能要求“发布到问题跟踪器”时

创建一个 GitHub Issue。

## 当技能要求“获取相关工单”时

运行 `gh issue view <number> --comments`。

## Wayfinding 操作

供 `/wayfinder` 使用。一个 **map（地图）** 对应一个主 Issue，相关任务作为其 **child issues（子 Issue）**。

- **地图**：一个带有 `wayfinder:map` 标签的 Issue，正文包含 Notes、Decisions-so-far 和 Fog。使用 `gh issue create --label wayfinder:map` 创建。
- **子任务**：通过 GitHub 子 Issue 功能将任务关联到地图，使用子 Issue API 调用 `gh api`。如果仓库未启用子 Issue，则在地图正文中添加任务清单，并在子任务正文顶部加入 `Part of #<map>`。标签格式为 `wayfinder:<type>`，其中类型为 `research`、`prototype`、`grilling` 或 `task`。任务被领取后，将其指派给负责实现的开发者。
- **阻塞关系**：优先使用 GitHub 原生 Issue 依赖关系，这是规范且能在 UI 中显示的表示方式。使用 `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>` 添加依赖边。`<blocker-db-id>` 必须是阻塞 Issue 的数字数据库 ID，可通过 `gh api repos/<owner>/<repo>/issues/<n> --jq .id` 获取，不能使用 `#number` 或 `node_id`。GitHub 通过 `issue_dependencies_summary.blocked_by` 返回尚未关闭的阻塞项。如果依赖功能不可用，则在子任务正文顶部添加 `Blocked by: #<n>, #<n>`。全部阻塞项关闭后，任务即解除阻塞。
- **查询可执行任务**：列出地图中所有开放的子 Issue，或任务清单中的开放任务；排除存在未关闭阻塞项或已经分配负责人的任务；按地图中的顺序选择第一个任务。
- **领取任务**：运行 `gh issue edit <n> --add-assignee @me`。这是会话中的首次写操作。
- **完成任务**：运行 `gh issue comment <n> --body "<answer>"`，然后运行 `gh issue close <n>`，最后在地图的 Decisions-so-far 中追加上下文指针（gist 及其链接）。
