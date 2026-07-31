"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import AnalysisConsole from "@/components/analysis/AnalysisConsole";

const examples = [
  {
    tag: "职场",
    title: "35岁转行，是冒险还是理性选择？",
    a: "稳定优先，风险要控制在能承受的范围内。",
    b: "把风险摊到10年周期看，越早试错成本越低。",
  },
  {
    tag: "消费",
    title: "该不该为“情绪价值”多付钱？",
    a: "为体验付费也是理性消费的一种。",
    b: "情绪是短期的，账单是长期的，先分清必要与想要。",
  },
  {
    tag: "教育",
    title: "标准答案之外，孩子该不该被鼓励“抬杠”？",
    a: "规则和共识是协作的基础，先学会遵守。",
    b: "质疑本身就是理解的开始，压制它代价更大。",
  },
];

export default function HomePage() {
  const { session, ready } = useAuth();
  const router = useRouter();

  const [presetText, setPresetText] = useState<string | undefined>(undefined);
  const [presetKey, setPresetKey] = useState(0);

  useEffect(() => {
    if (ready && !session) {
      router.replace("/login");
    }
  }, [ready, session, router]);

  if (!ready || !session) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-sm text-ink-faint">
        正在加载…
      </div>
    );
  }

  const greeting =
    session.type === "user" ? `尾号 ${session.phone.slice(-4)}` : "游客";

  function fillExample(title: string) {
    setPresetText(title);
    setPresetKey((k) => k + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <p className="font-mono text-xs tracking-wide text-secondary">
        欢迎回来，{greeting}
      </p>
      <h1 className="mt-2 max-w-xl font-display text-2xl font-semibold leading-snug text-ink sm:text-3xl">
        粘贴一段内容，看看它的第二视角。
      </h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-soft">
        我们会拆解信息结构、铺开不同立场、核对认知风险，并给出可以继续追问的思路。
      </p>

      <div className="mt-6">
        <AnalysisConsole presetText={presetText} presetKey={presetKey} />
      </div>

      <section className="mt-12">
        <h2 className="mb-4 font-display text-sm font-semibold uppercase tracking-wide text-ink-faint">
          灵感示例 · 点击直接填入
        </h2>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {examples.map((t) => (
            <button
              key={t.title}
              type="button"
              onClick={() => fillExample(t.title)}
              className="flex flex-col rounded-2xl border border-border bg-paper p-5 text-left transition hover:border-primary/40 hover:shadow-md"
            >
              <span className="w-fit rounded-full bg-paper-dim px-2.5 py-1 text-[11px] font-medium text-ink-soft">
                {t.tag}
              </span>
              <h3 className="mt-3 font-display text-base font-semibold leading-snug text-ink">
                {t.title}
              </h3>

              <div className="mt-4 space-y-3 text-sm">
                <div className="rounded-xl bg-primary-soft px-3.5 py-3">
                  <p className="text-xs font-semibold text-primary">第一视角</p>
                  <p className="mt-1 leading-relaxed text-ink-soft">{t.a}</p>
                </div>
                <div className="rounded-xl bg-secondary-soft px-3.5 py-3">
                  <p className="text-xs font-semibold text-secondary">第二视角</p>
                  <p className="mt-1 leading-relaxed text-ink-soft">{t.b}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
