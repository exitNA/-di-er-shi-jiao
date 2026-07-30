"use client";

import { useEffect, useRef, useState } from "react";
import Term from "./Term";

type ModuleKey = "breakdown" | "perspectives" | "risks" | "guide";
type ModuleStatus = "pending" | "loading" | "done";
type Phase = "idle" | "parsing" | "processing" | "error";

const MODULE_ORDER: ModuleKey[] = ["breakdown", "perspectives", "risks", "guide"];

const MODULE_META: Record<
  ModuleKey,
  { mark: string; title: string; loadingText: string; accent: "primary" | "secondary" | "caution" }
> = {
  breakdown: { mark: "①", title: "信息拆解图", loadingText: "正在拆解信息结构…", accent: "primary" },
  perspectives: { mark: "②", title: "多视角地图", loadingText: "正在铺开不同视角…", accent: "secondary" },
  risks: { mark: "③", title: "认知风险清单", loadingText: "正在核对认知风险…", accent: "caution" },
  guide: { mark: "④", title: "思考引导", loadingText: "正在生成思考线索…", accent: "primary" },
};

// 每个模块相对上一个模块完成的耗时（毫秒），用于模拟“逐个完成”的渐进渲染
const STEP_DELAYS = [1300, 1200, 1200, 1300];

function isLinkInput(value: string) {
  return /^(https?:\/\/|www\.)\S+$/i.test(value.trim());
}

export default function AnalysisConsole({
  presetText,
  presetKey,
}: {
  presetText?: string;
  presetKey?: number;
}) {
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [modules, setModules] = useState<Record<ModuleKey, ModuleStatus>>({
    breakdown: "pending",
    perspectives: "pending",
    risks: "pending",
    guide: "pending",
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  function clearAllTimers() {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  }

  // 支持从首页“灵感示例”一键填入输入框
  useEffect(() => {
    if (presetText === undefined) return;
    if (phase === "processing" || phase === "parsing") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 受控预填prop变化时同步内部输入框状态，属于合理的props->state同步
    setInput(presetText);
    setErrorMsg(null);
    setPhase("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetKey]);

  useEffect(() => {
    return () => clearAllTimers();
  }, []);

  function resetToIdle() {
    clearAllTimers();
    setPhase("idle");
    setErrorMsg(null);
    setModules({ breakdown: "pending", perspectives: "pending", risks: "pending", guide: "pending" });
  }

  function runProcessing() {
    setPhase("processing");
    setModules({
      breakdown: "loading",
      perspectives: "loading",
      risks: "loading",
      guide: "loading",
    });

    let elapsed = 0;
    MODULE_ORDER.forEach((key, i) => {
      elapsed += STEP_DELAYS[i];
      const t = setTimeout(() => {
        setModules((prev) => ({ ...prev, [key]: "done" }));
      }, elapsed);
      timers.current.push(t);
    });
  }

  function handleSubmit() {
    const trimmed = input.trim();
    if (!trimmed) return;

    setErrorMsg(null);

    if (isLinkInput(trimmed)) {
      setPhase("parsing");
      const t = setTimeout(() => {
        if (/fail/i.test(trimmed)) {
          setPhase("error");
          setErrorMsg("链接解析失败，请尝试直接粘贴文字内容");
          return;
        }
        runProcessing();
      }, 900);
      timers.current.push(t);
      return;
    }

    runProcessing();
  }

  function handleCancel() {
    resetToIdle();
  }

  const isBusy = phase === "parsing" || phase === "processing";
  const allDone = MODULE_ORDER.every((k) => modules[k] === "done");

  return (
    <section className="rounded-3xl border border-border bg-paper p-5 sm:p-6">
      <div className="flex flex-col gap-3">
        <textarea
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            if (phase === "error") {
              setPhase("idle");
              setErrorMsg(null);
            }
          }}
          disabled={isBusy}
          rows={4}
          placeholder="粘贴一段文字，或一个文章链接，看看它有哪些被忽略的角度……"
          className="w-full resize-none rounded-2xl border border-border bg-paper px-4 py-3.5 text-sm leading-relaxed text-ink outline-none transition focus:border-primary disabled:cursor-not-allowed disabled:bg-paper-dim disabled:text-ink-faint"
        />

        {errorMsg && (
          <div className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-xs leading-relaxed text-danger">
            {errorMsg}
          </div>
        )}

        <div className="flex items-center justify-between">
          <p className="text-[11px] text-ink-faint">
            演示环境：链接中包含 “fail” 字样会模拟解析失败
          </p>

          {!isBusy ? (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!input.trim()}
              className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-ink-faint/40 disabled:text-ink-faint"
            >
              提交分析
            </button>
          ) : (
            <div className="flex items-center gap-3">
              {phase === "parsing" && (
                <span className="flex items-center gap-1.5 text-xs text-ink-faint">
                  <Spinner />
                  正在解析链接…
                </span>
              )}
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-full border border-border px-5 py-2.5 text-sm font-medium text-ink-soft transition hover:bg-paper-dim"
              >
                取消
              </button>
            </div>
          )}
        </div>
      </div>

      {phase === "processing" ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {MODULE_ORDER.map((key) => (
            <ModuleCard key={key} moduleKey={key} status={modules[key]} inputText={input} />
          ))}
        </div>
      ) : null}

      {allDone && (
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={resetToIdle}
            className="text-xs font-medium text-ink-soft transition hover:text-primary"
          >
            分析新的内容 →
          </button>
        </div>
      )}
    </section>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-ink-faint/30 border-t-ink-soft"
      aria-hidden="true"
    />
  );
}

function ModuleCard({
  moduleKey,
  status,
  inputText,
}: {
  moduleKey: ModuleKey;
  status: ModuleStatus;
  inputText: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const meta = MODULE_META[moduleKey];
  const accentText =
    meta.accent === "primary"
      ? "text-primary"
      : meta.accent === "secondary"
      ? "text-secondary"
      : "text-caution";
  const accentSoftBg =
    meta.accent === "primary"
      ? "bg-primary-soft"
      : meta.accent === "secondary"
      ? "bg-secondary-soft"
      : "bg-caution-soft";

  return (
    <div className="rounded-2xl border border-border p-4">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={!collapsed}
      >
        <span className="text-[10px] text-ink-faint">{collapsed ? "▶" : "▼"}</span>
        <span className={`font-display text-base font-semibold ${accentText}`}>{meta.mark}</span>
        <h3 className="font-display text-sm font-semibold text-ink">{meta.title}</h3>
        {status === "loading" && (
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-ink-faint">
            <Spinner />
            {meta.loadingText}
          </span>
        )}
      </button>

      {!collapsed && (
        <div className="mt-3">
          {status === "loading" && <SkeletonBody />}
          {status === "done" && (
            <ModuleContent moduleKey={moduleKey} inputText={inputText} accentSoftBg={accentSoftBg} />
          )}
          {status === "pending" && <SkeletonBody dim />}
        </div>
      )}
    </div>
  );
}

function SkeletonBody({ dim = false }: { dim?: boolean }) {
  return (
    <div className={`space-y-2 ${dim ? "opacity-40" : "animate-pulse"}`}>
      <div className="h-2.5 w-4/5 rounded-full bg-paper-dim" />
      <div className="h-2.5 w-full rounded-full bg-paper-dim" />
      <div className="h-2.5 w-3/5 rounded-full bg-paper-dim" />
    </div>
  );
}

// 多视角地图：按立场分类的展示数据
const STANCE_META = {
  support: { label: "支持", mark: "＋", text: "text-support", bg: "bg-support-soft" },
  oppose: { label: "反对", mark: "－", text: "text-oppose", bg: "bg-oppose-soft" },
  controversial: { label: "争议", mark: "≈", text: "text-controversial", bg: "bg-controversial-soft" },
  unknown: { label: "未知", mark: "？", text: "text-unknown", bg: "bg-unknown-soft" },
} as const;

const STANCE_ITEMS: { stance: keyof typeof STANCE_META; summary: string }[] = [
  { stance: "support", summary: "认为该判断合理，收益大于潜在的风险与成本。" },
  { stance: "oppose", summary: "认为风险被低估了，反对方给出的代价被忽视了。" },
  { stance: "controversial", summary: "双方各有数据支撑，目前没有压倒性的一方。" },
  { stance: "unknown", summary: "样本量或时间窗口都不够，暂时无法下结论。" },
];

// 认知风险清单：谬误类型与对应配色（关键映射，不可随意更换颜色）
const RISK_ITEMS: {
  label: string;
  color: "orange" | "blue" | "purple" | "red" | "gray" | "yellow" | "lightgray";
  hint: string;
  definition: string;
}[] = [
  {
    label: "滑坡谬误",
    color: "orange",
    hint: "文中把第一步和最坏结果直接划了等号",
    definition: "假设一步让步会不可避免地引发一连串最坏结果，中间缺少必然性论证。",
  },
  {
    label: "幸存者偏差",
    color: "blue",
    hint: "举例只覆盖了“留下来”的那部分样本",
    definition: "只统计了留下来 / 成功的样本，忽略了被淘汰、看不见的那部分。",
  },
  {
    label: "稻草人论证",
    color: "purple",
    hint: "反驳的版本比对方原话更极端",
    definition: "把对方观点简化、扭曲成更容易反驳的版本，再去反驳这个版本。",
  },
  {
    label: "诉诸权威",
    color: "red",
    hint: "论据主要来自“某专家说”而非数据本身",
    definition: "用身份、头衔或地位代替了对论据本身的检验。",
  },
  {
    label: "循环论证",
    color: "gray",
    hint: "结论其实已经出现在了前提里",
    definition: "结论其实已经被悄悄放进了前提里，论证只是绕了一圈回到原点。",
  },
  {
    label: "虚假两难",
    color: "yellow",
    hint: "只给了两个选项，中间地带被忽略",
    definition: "把连续的多种可能性压缩成非此即彼的两个选项，掩盖了中间地带。",
  },
  {
    label: "其他",
    color: "lightgray",
    hint: "未归类的潜在风险点，建议自行核查",
    definition: "未归入以上类别的潜在风险点，建议结合上下文自行核查。",
  },
];

function ModuleContent({
  moduleKey,
  inputText,
  accentSoftBg,
}: {
  moduleKey: ModuleKey;
  inputText: string;
  accentSoftBg: string;
}) {
  const snippet =
    inputText.trim().length > 28 ? `${inputText.trim().slice(0, 28)}…` : inputText.trim();

  if (moduleKey === "breakdown") {
    return (
      <div className="text-xs leading-relaxed text-ink-soft">
        <div className={`rounded-lg ${accentSoftBg} px-3 py-2 font-medium text-ink`}>
          核心议题：{snippet || "（未命名内容）"}
        </div>
        <div className="mt-2 space-y-1.5 border-l-2 border-primary/25 pl-3">
          <p>· 关键主张 —— 文本中提出的主要结论</p>
          <p>· 支撑依据 —— 用于佐证结论的例子或数据</p>
          <p>
            ·{" "}
            <Term
              label="隐藏前提"
              definition="结论成立所默认、但文本中并未明说的假设。一旦这个假设不成立，结论也会随之动摇。"
            />{" "}
            —— 结论成立所默认的假设
          </p>
        </div>
      </div>
    );
  }

  if (moduleKey === "perspectives") {
    return (
      <div className="space-y-2 text-xs leading-relaxed">
        {STANCE_ITEMS.map(({ stance, summary }) => {
          const m = STANCE_META[stance];
          return (
            <div key={stance} className={`rounded-lg ${m.bg} px-3 py-2`}>
              <p className={`flex items-center gap-1.5 font-semibold ${m.text}`}>
                <span aria-hidden="true">{m.mark}</span>
                {m.label}
              </p>
              <p className="mt-0.5 text-ink-soft">{summary}</p>
            </div>
          );
        })}
      </div>
    );
  }

  if (moduleKey === "risks") {
    return (
      <ul className="space-y-2 text-xs leading-relaxed text-ink-soft">
        {RISK_ITEMS.map((r) => (
          <li key={r.label} className="flex flex-wrap items-center gap-2">
            <Term label={r.label} definition={r.definition} color={r.color} asTag />
            <span>{r.definition}</span>
          </li>
        ))}
      </ul>
    );
  }

  const questions = [
    "如果结论反过来，什么条件下会成立？",
    "这个判断依赖的隐藏前提是什么？",
    "换一个利益相关方来看，会有什么不同？",
  ];
  return (
    <ol className="space-y-1.5 text-xs leading-relaxed text-ink-soft">
      {questions.map((q, i) => (
        <li key={q} className="flex gap-2">
          <span className="font-mono text-[11px] text-primary">{i + 1}.</span>
          <span>{q}</span>
        </li>
      ))}
    </ol>
  );
}
