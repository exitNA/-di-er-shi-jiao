"use client";

import { useState } from "react";
import { AnalysisForm } from "./analysis-form";

const examples = [
  ["职场", "35岁转行，是冒险还是理性选择？", "稳定优先，风险要控制在能承受的范围内。", "把风险摊到10年周期看，越早试错成本越低。"],
  ["消费", "该不该为“情绪价值”多付钱？", "为体验付费也是理性消费的一种。", "情绪是短期的，账单是长期的，先分清必要与想要。"],
  ["教育", "标准答案之外，孩子该不该被鼓励“抬杠”？", "规则和共识是协作的基础，先学会遵守。", "质疑本身就是理解的开始，压制它代价更大。"],
] as const;

export function HomeAnalysisWorkspace() {
  const [content, setContent] = useState("");
  return <><AnalysisForm content={content} onContentChange={setContent} compact />
    <section className="mt-12"><h2 className="mb-4 font-display text-sm font-semibold uppercase tracking-wide text-ink-faint">灵感示例 · 点击直接填入</h2><div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{examples.map(([tag, title, first, second]) => <button key={title} type="button" onClick={() => setContent(title)} className="flex flex-col rounded-2xl border border-border bg-paper p-5 text-left transition hover:shadow-md"><span className="w-fit rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] font-medium text-neutral-600">{tag}</span><h3 className="mt-3 font-display text-base font-semibold leading-snug text-ink">{title}</h3><div className="mt-4 space-y-3 text-sm"><div className="rounded-xl bg-indigo-50 px-3.5 py-3"><p className="text-xs font-semibold text-primary">第一视角</p><p className="mt-1 leading-relaxed text-neutral-600">{first}</p></div><div className="rounded-xl bg-teal-50 px-3.5 py-3"><p className="text-xs font-semibold text-secondary">第二视角</p><p className="mt-1 leading-relaxed text-neutral-600">{second}</p></div></div></button>)}</div></section></>;
}
