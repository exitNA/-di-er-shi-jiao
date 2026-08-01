"use client";

import { ArrowUpRight, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

const maxLength = 20_000;

const messages = {
  EMPTY: "请输入需要分析的文本。",
  TOO_LONG: "文本不能超过 20,000 字符。",
  UNSAFE_CONTENT: "文本包含无法处理的控制字符。",
  REQUEST_FAILED: "提交失败，请稍后重试。",
};

export function AnalysisForm({ content: controlledContent, onContentChange, compact = false }: { content?: string; onContentChange?: (value: string) => void; compact?: boolean }) {
  const router = useRouter();
  const idempotencyKey = useRef<string | null>(null);
  const [uncontrolledContent, setUncontrolledContent] = useState("");
  const content = controlledContent ?? uncontrolledContent;
  const setContent = onContentChange ?? setUncontrolledContent;
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const isBlank = !content.trim();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBlank) {
      setError(messages.EMPTY);
      return;
    }

    idempotencyKey.current ??= crypto.randomUUID();
    setPending(true);
    setError(undefined);

    try {
      const response = await fetch("/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, idempotencyKey: idempotencyKey.current }),
      });
      if (response.status === 401) {
        router.push("/login");
        return;
      }
      const body = await response.json().catch(() => null) as { jobId?: string; code?: keyof typeof messages } | null;
      if (response.ok && body?.jobId) {
        router.push(`/analysis/${body.jobId}`);
        return;
      }
      setError(body?.code ? messages[body.code] : messages.REQUEST_FAILED);
    } catch {
      setError(messages.REQUEST_FAILED);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className={compact ? "mt-10 overflow-hidden rounded-[1.75rem] border border-border bg-white/90 p-2 shadow-[0_20px_55px_-30px_rgba(22,58,54,0.38)]" : "mt-10 space-y-4"} onSubmit={submit}>
      <label className={compact ? "flex items-center gap-2 px-4 pt-3 text-sm font-semibold text-primary" : "block text-sm font-medium"} htmlFor="analysis-content">
        {compact ? <Sparkles size={15} aria-hidden="true" /> : null} 想分析的内容
      </label>
      <textarea
        id="analysis-content"
        name="content"
        value={content}
        onChange={(event) => {
          idempotencyKey.current = null;
          setContent(event.target.value);
        }}
        maxLength={maxLength}
        rows={compact ? 3 : 10}
        placeholder={compact ? "输入你想分析的内容（Shift + Enter 换行）" : undefined}
        className={compact ? "min-h-40 w-full resize-none bg-transparent px-4 py-3 text-base leading-7 outline-none placeholder:text-ink-faint/70" : "w-full rounded-lg border border-neutral-300 bg-white p-4 leading-7"}
        aria-describedby="analysis-content-help analysis-content-count"
      />
      <div className={compact ? "flex flex-wrap items-center justify-between gap-3 border-t border-border/70 px-4 py-3 text-sm text-ink-faint" : "flex flex-wrap items-center justify-between gap-2 px-2 text-sm text-neutral-600"}>
        <p id="analysis-content-help">支持 1–20,000 个字符，请粘贴需要核查的完整文本。</p>
        <output id="analysis-content-count" aria-live="polite">{content.length.toLocaleString("en-US")} / 20,000</output>
      </div>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <button
        type="submit"
        disabled={pending || isBlank}
        aria-label="展开第二视角"
        className={compact ? "ml-auto flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-35" : "rounded-lg bg-neutral-900 px-5 py-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"}
      >
        {pending ? "正在展开…" : compact ? <>展开第二视角 <ArrowUpRight size={16} aria-hidden="true" /></> : "开始分析"}
      </button>
    </form>
  );
}
