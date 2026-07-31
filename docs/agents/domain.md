# 领域文档

本文说明工程技能在探索代码库时，应如何读取和使用本仓库的领域文档。

## 探索前需要读取

- 仓库根目录下的 **`CONTEXT.md`**；或者
- 如果根目录存在 **`CONTEXT-MAP.md`**，则根据其中的指引读取与当前主题相关的各个 `CONTEXT.md`。
- **`docs/adr/`** 中与当前工作区域有关的 ADR。在多上下文仓库中，还应检查 `src/<context>/docs/adr/` 下对应上下文的决策记录。

如果这些文件不存在，**直接继续，不要提示**。不要报告文件缺失，也不要预先建议创建。`/domain-modeling` 技能会在术语或决策真正明确时按需创建这些文件；该技能可通过 `/grill-with-docs` 和 `/improve-codebase-architecture` 触发。

## 文件结构

单上下文仓库（大多数仓库）：

```text
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

多上下文仓库（根目录存在 `CONTEXT-MAP.md`）：

```text
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← 系统级决策
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← 上下文级决策
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## 使用术语表中的词汇

当输出内容涉及领域概念时，例如 Issue 标题、重构建议、假设或测试名称，应使用 `CONTEXT.md` 中定义的术语。不要改用术语表明确排除的同义词。

如果术语表中没有所需概念，通常意味着两种情况：你正在创造项目并未使用的新语言，应重新考虑；或者领域文档确实存在空白，应记录下来交给 `/domain-modeling` 处理。

## 标明与 ADR 的冲突

如果输出内容与已有 ADR 冲突，应明确指出，不要静默覆盖：

> _这与 ADR-0007（事件溯源订单）冲突——但值得重新讨论，因为……_
