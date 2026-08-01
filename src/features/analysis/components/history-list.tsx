import Link from "next/link";

import type { HistoryItem } from "@/features/analysis/server/analysis-repository";

const statusLabels: Record<HistoryItem["status"], string> = {
  queued: "等待",
  running: "分析中",
  partial: "部分完成",
  completed: "已完成",
  recoverable: "待恢复",
};

const dateTime = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function HistoryList({ items }: { items: readonly HistoryItem[] }) {
  if (!items.length) {
    return (
      <section className="mt-10 rounded-[1.5rem] border border-dashed border-border bg-white/50 p-7">
        <h2 className="font-display text-xl font-semibold">还没有认知体检报告</h2>
        <p className="mt-2 leading-7 text-ink-faint">提交一段文本后，它会连同分析进度保存在这里。</p>
        <Link className="mt-5 inline-flex rounded-full bg-primary px-4 py-2 text-sm font-medium text-white" href="/">
          开始第一次分析
        </Link>
      </section>
    );
  }

  return (
    <ol className="mt-10 space-y-4" aria-label="认知体检历史">
      {items.map((item) => (
        <li key={item.jobId} className="rounded-[1.5rem] border border-border bg-white/65 p-5 shadow-sm transition hover:border-secondary/40 hover:shadow-lg hover:shadow-primary/5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="rounded-full bg-mist px-2.5 py-1 text-xs font-semibold text-primary">{statusLabels[item.status]}</span>
            <time className="font-mono text-xs text-ink-faint" dateTime={item.createdAt}>
              {dateTime.format(new Date(item.createdAt))}
            </time>
          </div>
          <p className="mt-4 line-clamp-2 leading-7 text-ink">{item.materialPreview}</p>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-ink-faint">
              已完成 {item.completedModuleCount} / 6 个模块
            </span>
            <Link className="rounded-full border border-border bg-paper px-3.5 py-2 font-medium text-primary transition hover:border-secondary" href={`/analysis/${item.jobId}`}>
              继续查看
            </Link>
          </div>
        </li>
      ))}
    </ol>
  );
}
