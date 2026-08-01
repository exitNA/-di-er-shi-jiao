"use client";

import { useState } from "react";
import { AnalysisForm } from "./analysis-form";

const examples = [
  ["职场", "35岁转行，是冒险还是理性选择？", "稳定优先，风险要控制在能承受的范围内。", "把风险摊到10年周期看，越早试错成本越低。"],
  ["消费", "该不该为“情绪价值”多付钱？", "为体验付费也是理性消费的一种。", "情绪是短期的，账单是长期的，先分清必要与想要。"],
  ["教育", "标准答案之外，孩子该不该被鼓励“抬杠”？", "规则和共识是协作的基础，先学会遵守。", "质疑本身就是理解的开始，压制它代价更大。"],
  ["公共议题", "一项新政策发布后，应该立刻表态支持或反对吗？", "先看它回应了什么现实问题。", "再问代价由谁承担、哪些效果仍待验证。"],
] as const;

export function HomeAnalysisWorkspace() {
  const [content, setContent] = useState("");
  return <><div className="mx-auto max-w-4xl"><AnalysisForm content={content} onContentChange={setContent} compact /></div>
    <section className="mt-14"><div className="mb-5 flex items-center justify-between"><h2 className="font-mono text-xs font-medium tracking-[0.16em] text-ink-faint">从这些问题开始</h2><p className="text-xs text-ink-faint">点击填入思考桌</p></div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{examples.map(([tag, title, first, second]) => <button key={title} type="button" onClick={() => setContent(title)} className="group relative overflow-hidden rounded-[1.5rem] border border-border bg-white/55 p-4 text-left transition duration-200 hover:-translate-y-1 hover:border-secondary/45 hover:shadow-xl hover:shadow-primary/10"><span className="absolute left-4 top-4 rounded-full bg-forest-soft px-2.5 py-1 text-[11px] font-medium text-primary">{tag}</span><h3 className="pt-9 font-display text-base font-semibold leading-snug text-ink">{title}</h3><div className="mt-4 grid gap-2 text-sm"><div className="rounded-xl bg-apricot/35 px-3 py-2.5"><p className="text-xs font-semibold text-primary">第一视角</p><p className="mt-1 line-clamp-2 leading-relaxed text-ink-faint">{first}</p></div><div className="rounded-xl bg-mist px-3 py-2.5"><p className="text-xs font-semibold text-secondary">第二视角</p><p className="mt-1 line-clamp-2 leading-relaxed text-ink-faint">{second}</p></div></div><span aria-hidden="true" className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-mist/70 transition group-hover:scale-125" /></button>)}</div></section></>;
}
