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
      <section className="mt-10 rounded-lg border border-neutral-300 bg-white p-6">
        <h2 className="text-lg font-medium">还没有认知体检报告</h2>
        <p className="mt-2 text-neutral-600">提交一段文本后，报告会保存在这里。</p>
        <Link className="mt-4 inline-block underline" href="/">
          开始第一次分析
        </Link>
      </section>
    );
  }

  return (
    <ol className="mt-10 space-y-4" aria-label="认知体检历史">
      {items.map((item) => (
        <li key={item.jobId} className="rounded-lg border border-neutral-300 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{statusLabels[item.status]}</span>
            <time className="text-sm text-neutral-600" dateTime={item.createdAt}>
              {dateTime.format(new Date(item.createdAt))}
            </time>
          </div>
          <p className="mt-3 leading-7">{item.materialPreview}</p>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-neutral-600">
              已完成 {item.completedModuleCount} / 6 个模块
            </span>
            <Link className="underline" href={`/analysis/${item.jobId}`}>
              打开报告
            </Link>
          </div>
        </li>
      ))}
    </ol>
  );
}
